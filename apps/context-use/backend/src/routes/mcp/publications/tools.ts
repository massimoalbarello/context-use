import type { McpServer } from '@modelcontextprotocol/server';
import type { McpClientAuthorizationPrincipal } from '#backend/models/mcp-client-authorizations/model.ts';
import {
  assetReadableId,
  ENTITY_ADDRESS_PREFIX,
  entityReadableId,
  PAGE_ADDRESS_PREFIX,
  pageReadableId,
} from '#backend/models/readable-ids/addresses.ts';
import { MCP_READ_TOOL_ANNOTATIONS } from '#backend/routes/mcp/tool-annotations.ts';
import { mcpToolError, mcpToolSuccess } from '#backend/routes/mcp/tool-result.ts';
import type { PublicationApprovalServiceContract } from '#backend/services/publications/approval-service.ts';
import { PublicationStatusInputSchema, PublicationStatusOutputSchema } from './model.ts';

export function registerPublicationTools({
  server,
  principal,
  publicationStatusService,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  publicationStatusService: Pick<PublicationApprovalServiceContract, 'status'>;
}): void {
  server.registerTool(
    'read_publication_status',
    {
      title: 'Read publication status',
      description:
        'Read current publication status for an owned page, entity, or asset. Check before editing an existing page; an active publication requires informed user confirmation even when its latest revision is private. Records are always private. This tool cannot publish or unpublish.',
      inputSchema: PublicationStatusInputSchema,
      outputSchema: PublicationStatusOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const resource = address.startsWith(PAGE_ADDRESS_PREFIX)
        ? { resourceType: 'page' as const, readableId: pageReadableId(address) }
        : address.startsWith(ENTITY_ADDRESS_PREFIX)
          ? { resourceType: 'entity' as const, readableId: entityReadableId(address) }
          : { resourceType: 'asset' as const, readableId: assetReadableId(address) };
      const publication = await publicationStatusService.status({
        ...resource,
        ownerId: principal.ownerId,
      });
      if (!publication) {
        return mcpToolError({ code: 'not_found', message: 'Resource not found.' });
      }
      return mcpToolSuccess({
        resourceType: publication.resourceType,
        publicId: publication.publicId,
        publishedAt: publication.publishedAt,
        ...(publication.resourceType === 'page'
          ? { publishedRevisionNumber: publication.publishedRevisionNumber }
          : {}),
      });
    },
  );
}
