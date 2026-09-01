import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#models/knowledge-pages/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import { PageAddressSchema, pageAddress, pageReadableId } from '#routes/mcp/coordinates.ts';
import {
  McpKnowledgePageSchema,
  McpKnowledgePageSummarySchema,
  mcpArchiveBlockers,
  mcpKnowledgePage,
  mcpKnowledgePageSummary,
} from '#routes/mcp/pages/model.ts';
import {
  DEFAULT_MCP_LIST_LIMIT,
  decodeMcpCursor,
  encodeMcpCursor,
  McpListInputSchema,
} from '#routes/mcp/pagination.ts';
import {
  MCP_ARCHIVE_TOOL_ANNOTATIONS,
  MCP_READ_TOOL_ANNOTATIONS,
  MCP_WRITE_TOOL_ANNOTATIONS,
} from '#routes/mcp/tool-annotations.ts';
import { mcpToolError, mcpToolSuccess } from '#routes/mcp/tool-result.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';

const MarkdownSchema = z
  .string()
  .min(1)
  .max(MAX_KNOWLEDGE_PAGE_BYTES)
  .describe('Complete Markdown document beginning with one H1 title');

const CreateKnowledgePageInputSchema = z.object({
  markdown: MarkdownSchema,
  allowDuplicate: z
    .boolean()
    .optional()
    .describe('Retry with true only after a title-conflict result and a deliberate decision'),
});

const PageAddressInputSchema = z.object({ address: PageAddressSchema });

const UpdateKnowledgePageInputSchema = PageAddressInputSchema.extend({
  expectedRevisionNumber: z.number().int().positive(),
  markdown: MarkdownSchema,
});

const KnowledgePageListOutputSchema = z.object({
  items: z.array(McpKnowledgePageSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

const ArchiveKnowledgePageOutputSchema = z.object({
  archived: z.literal(true),
  address: PageAddressSchema,
});

function linkTargetAddress(target: string): string {
  return `context-use://${target}`;
}

export function registerKnowledgePageTools({
  server,
  principal,
  pagesService,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  pagesService: KnowledgePagesServiceContract;
}): void {
  const actor = {
    kind: 'mcp_client' as const,
    clientAuthorizationId: principal.clientAuthorizationId,
    name: principal.clientAuthorizationName,
  };

  server.registerTool(
    'create_knowledge_page',
    {
      title: 'Create knowledge page',
      description:
        'Create one versioned knowledge page from complete Markdown. Internal links must use canonical context-use addresses.',
      inputSchema: CreateKnowledgePageInputSchema,
      outputSchema: McpKnowledgePageSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    async (input) => {
      const result = await pagesService.create({ ownerId: principal.ownerId, actor, ...input });
      if (result.state === 'saved') {
        return mcpToolSuccess(mcpKnowledgePage(result.page));
      }
      if (result.state === 'title_conflict') {
        return mcpToolError({
          code: 'page_title_conflict',
          message:
            'A page with this title already exists. Use a more specific title, or retry with allowDuplicate only after deciding the duplicate is intentional.',
          details: { allowDuplicateRetryAvailable: true },
        });
      }
      if (result.state === 'link_target_not_found') {
        return mcpToolError({
          code: 'link_target_not_found',
          message: 'A linked target does not exist or is not available to this owner.',
          details: { target: linkTargetAddress(result.target) },
        });
      }
      if (result.state === 'invalid_markdown') {
        return mcpToolError({ code: 'invalid_markdown', message: result.message });
      }
      return mcpToolError({ code: 'not_found', message: 'Knowledge page not found.' });
    },
  );

  server.registerTool(
    'list_knowledge_pages',
    {
      title: 'List knowledge pages',
      description:
        'List active knowledge pages without searching. Pass nextCursor unchanged to continue the list.',
      inputSchema: McpListInputSchema,
      outputSchema: KnowledgePageListOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ cursor, limit = DEFAULT_MCP_LIST_LIMIT }) => {
      const decoded = decodeMcpCursor({ cursor, list: 'knowledge_pages' });
      if (decoded.state === 'invalid') {
        return mcpToolError({
          code: 'invalid_cursor',
          message: 'The knowledge-page-list cursor is invalid. Restart the list without a cursor.',
        });
      }
      const page = await pagesService.list({
        ownerId: principal.ownerId,
        limit,
        offset: decoded.offset,
      });
      return mcpToolSuccess({
        items: page.items.map(mcpKnowledgePageSummary),
        total: page.total,
        nextCursor: encodeMcpCursor({ list: 'knowledge_pages', offset: page.nextOffset }),
      });
    },
  );

  server.registerTool(
    'read_knowledge_page',
    {
      title: 'Read knowledge page',
      description: 'Read one active knowledge page by its exact canonical page address.',
      inputSchema: PageAddressInputSchema,
      outputSchema: McpKnowledgePageSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const page = await pagesService.detail({
        ownerId: principal.ownerId,
        readableId: pageReadableId(address),
      });
      return page
        ? mcpToolSuccess(mcpKnowledgePage(page))
        : mcpToolError({ code: 'not_found', message: 'Knowledge page not found.' });
    },
  );

  server.registerTool(
    'update_knowledge_page',
    {
      title: 'Update knowledge page',
      description:
        'Create a new revision of one knowledge page. expectedRevisionNumber is required to prevent overwriting concurrent changes.',
      inputSchema: UpdateKnowledgePageInputSchema,
      outputSchema: McpKnowledgePageSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    async ({ address, expectedRevisionNumber, markdown }) => {
      const result = await pagesService.update({
        ownerId: principal.ownerId,
        actor,
        readableId: pageReadableId(address),
        expectedRevisionNumber,
        markdown,
      });
      if (result.state === 'saved') {
        return mcpToolSuccess(mcpKnowledgePage(result.page));
      }
      if (result.state === 'revision_conflict') {
        return mcpToolError({
          code: 'revision_conflict',
          message:
            'The page changed since it was read. Reread the page, reconcile the new content, and retry with the current revision number; do not overwrite automatically.',
          details: { address, currentRevisionNumber: result.currentRevisionNumber },
        });
      }
      if (result.state === 'link_target_not_found') {
        return mcpToolError({
          code: 'link_target_not_found',
          message: 'A linked target does not exist or is not available to this owner.',
          details: { target: linkTargetAddress(result.target) },
        });
      }
      if (result.state === 'invalid_markdown') {
        return mcpToolError({ code: 'invalid_markdown', message: result.message });
      }
      return mcpToolError({ code: 'not_found', message: 'Knowledge page not found.' });
    },
  );

  server.registerTool(
    'archive_knowledge_page',
    {
      title: 'Archive knowledge page',
      description:
        'Archive one knowledge page. This is destructive and succeeds only when no active inbound references block it.',
      inputSchema: PageAddressInputSchema,
      outputSchema: ArchiveKnowledgePageOutputSchema,
      annotations: MCP_ARCHIVE_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const result = await pagesService.archive({
        ownerId: principal.ownerId,
        readableId: pageReadableId(address),
      });
      if (result.state === 'not_found') {
        return mcpToolError({ code: 'not_found', message: 'Knowledge page not found.' });
      }
      if (result.state === 'resource_in_use') {
        return mcpToolError({
          code: 'resource_in_use',
          message:
            'Archiving is blocked by active pages. Surface these blockers to the user; do not edit or archive them without a new user-informed decision.',
          details: { blockers: mcpArchiveBlockers(result.blockers) },
        });
      }
      return mcpToolSuccess({ archived: true, address: pageAddress(pageReadableId(address)) });
    },
  );
}
