import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import { SearchHypermediaOutputSchema } from '#backend/routes/mcp/hypermedia-retrieval/model.ts';
import { McpKnowledgePageSchema } from '#backend/routes/mcp/pages/model.ts';
import type { CreatePageVariables } from '../queries/pages';

export type Page = z.infer<typeof McpKnowledgePageSchema>;
const ToolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export class PageToolError extends Error {
  readonly code: string;
  constructor(error: z.infer<typeof ToolErrorSchema>['error']) {
    super(
      error.code === 'revision_conflict'
        ? 'This page changed elsewhere. Your draft has not been saved.'
        : error.message,
    );
    this.code = error.code;
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

  async search(query: string) {
    const result = await this.call({
      name: 'search_hypermedia',
      args: { query, resourceTypes: ['knowledge_page'], limit: 5 },
    });
    const { results, truncated } = SearchHypermediaOutputSchema.parse(result.structuredContent);
    return { pages: results.filter((item) => item.resourceType === 'knowledge_page'), truncated };
  }

  async read(address: string) {
    const result = await this.call({ name: 'read_knowledge_page', args: { address } });
    return McpKnowledgePageSchema.parse(result.structuredContent);
  }

  private async guideVersion() {
    const result = await this.call({ name: 'read_hypermedia_curation_guide' });
    return z.object({ guide_version: z.string() }).parse(result.structuredContent).guide_version;
  }

  async save({
    page,
    markdown,
    temporalCoverage,
    changeMessage,
  }: CreatePageVariables & { page: Page }) {
    const result = await this.call({
      name: 'update_knowledge_page',
      args: {
        address: page.address,
        expectedRevisionNumber: page.revisionNumber,
        markdown,
        temporalCoverage,
        guide_version: await this.guideVersion(),
        changeMessage: changeMessage ?? 'Edited page in Context Use app',
      },
    });
    return McpKnowledgePageSchema.parse(result._meta?.page);
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
