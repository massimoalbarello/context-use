import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import {
  KnowledgePageListOutputSchema,
  McpKnowledgePageSchema,
  McpKnowledgePageSummarySchema,
} from '#backend/routes/mcp/pages/model.ts';

export type Page = z.infer<typeof McpKnowledgePageSchema>;
export type PageSummary = z.infer<typeof McpKnowledgePageSummarySchema>;
const ToolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    blockers: z.array(z.object({ page: McpKnowledgePageSummarySchema })).optional(),
  }),
});

export class PageToolError extends Error {
  readonly code: string;
  readonly blockers: PageSummary[];
  constructor(error: z.infer<typeof ToolErrorSchema>['error']) {
    const messages: Record<string, string> = {
      resource_in_use: 'Other pages reference this page. Review those references before archiving.',
      resource_published: 'Unpublish this page in Context Use before archiving it.',
      revision_conflict: 'This page changed elsewhere. Your draft has not been saved.',
      page_title_conflict:
        'A page with this title already exists. Choose a different title or confirm the duplicate.',
    };
    super(messages[error.code] ?? error.message);
    this.code = error.code;
    this.blockers = error.blockers?.map(({ page }) => page) ?? [];
  }
}

export class PagesClient {
  constructor(readonly app: Pick<App, 'callServerTool' | 'openLink'>) {}

  private async call({ name, args = {} }: { name: string; args?: Record<string, unknown> }) {
    const result = await this.app.callServerTool({ name, arguments: args });
    const failure = ToolErrorSchema.safeParse(result.structuredContent);
    if (failure.success) {
      throw new PageToolError(failure.data.error);
    }
    if (result.isError) {
      throw new Error('The page operation failed. Try again.');
    }
    if (
      z
        .object({ code: z.literal('hypermedia_curation_guide_required') })
        .safeParse(result.structuredContent).success
    ) {
      throw new Error('The curation guide changed. Try again to use the current guide.');
    }
    return result;
  }

  async list(cursor?: string) {
    const result = await this.call({ name: 'list_knowledge_pages', args: { cursor } });
    return KnowledgePageListOutputSchema.parse(result.structuredContent);
  }

  async read(address: string) {
    const result = await this.call({ name: 'read_knowledge_page', args: { address } });
    return McpKnowledgePageSchema.parse(result.structuredContent);
  }

  private async guideVersion() {
    const result = await this.call({ name: 'read_hypermedia_curation_guide' });
    return z.object({ guide_version: z.string() }).parse(result.structuredContent).guide_version;
  }

  async save(input: {
    page?: Page;
    markdown: string;
    temporalCoverage?: string | null;
    changeMessage?: string;
    allowDuplicate?: boolean;
  }) {
    const { page, changeMessage, ...values } = input;
    const result = await this.call({
      name: page ? 'update_knowledge_page' : 'create_knowledge_page',
      args: {
        ...values,
        ...(page ? { address: page.address, expectedRevisionNumber: page.revisionNumber } : {}),
        guide_version: await this.guideVersion(),
        changeMessage:
          changeMessage ??
          (page ? 'Edited page in Context Use app' : 'Created page in Context Use app'),
      },
    });
    return McpKnowledgePageSchema.parse(result._meta?.page);
  }

  async archive(address: string) {
    const result = await this.call({
      name: 'archive_knowledge_page',
      args: {
        address,
        guide_version: await this.guideVersion(),
        changeMessage: 'Archived page in Context Use app',
      },
    });
    z.object({ archived: z.literal(true) }).parse(result.structuredContent);
  }
}

export function initialPage(result: {
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}) {
  const parsed = McpKnowledgePageSchema.safeParse(result._meta?.page ?? result.structuredContent);
  return parsed.success ? parsed.data : null;
}

export function initialNotice(result: { structuredContent?: unknown }) {
  const failure = ToolErrorSchema.safeParse(result.structuredContent);
  if (failure.success) {
    return new PageToolError(failure.data.error).message;
  }
  if (z.object({ archived: z.literal(true) }).safeParse(result.structuredContent).success) {
    return 'Page archived. You can restore it from the Archived filter in Context Use.';
  }
  return '';
}
