import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import { McpAssetSchema } from '#backend/routes/mcp/assets/model.ts';
import { McpEntityDetailSchema } from '#backend/routes/mcp/entities/detail-model.ts';
import {
  SearchHypermediaInputSchema,
  SearchHypermediaOutputSchema,
} from '#backend/routes/mcp/hypermedia-retrieval/model.ts';
import { McpKnowledgePageSchema } from '#backend/routes/mcp/pages/model.ts';
import { internalLink } from '../lib/internal-link';
import type { CreatePageVariables } from '../queries/pages';

export type SearchHit = z.infer<typeof SearchHypermediaOutputSchema>['results'][number];
export type SearchInput = z.infer<typeof SearchHypermediaInputSchema>;
const PICKER_LIMIT = 10;

export function pickerInput(input: SearchInput) {
  return { ...input, limit: Math.min(input.limit ?? PICKER_LIMIT, PICKER_LIMIT) };
}

export type Entity = z.infer<typeof McpEntityDetailSchema>;
export type Asset = z.infer<typeof McpAssetSchema>;
export type Page = z.infer<typeof McpKnowledgePageSchema>;

const resourceReaders = {
  page: {
    tool: 'read_knowledge_page',
    schema: McpKnowledgePageSchema.transform((value) => ({ kind: 'page', value }) as const),
  },
  entity: {
    tool: 'read_entity',
    schema: McpEntityDetailSchema.transform((value) => ({ kind: 'entity', value }) as const),
  },
  asset: {
    tool: 'read_asset',
    schema: McpAssetSchema.transform((value) => ({ kind: 'asset', value }) as const),
  },
};

const launchSchema = z.union([
  resourceReaders.page.schema,
  resourceReaders.entity.schema,
  resourceReaders.asset.schema,
]);

export function launchResource(result: {
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}) {
  if (result._meta?.search != null) {
    const input = SearchHypermediaInputSchema.safeParse(result._meta.search);
    const output = SearchHypermediaOutputSchema.safeParse(result.structuredContent);
    if (input.success && output.success) {
      const search = pickerInput(input.data);
      const { results, truncated } = output.data;
      return {
        kind: 'search',
        value: {
          input: search,
          results: results.slice(0, search.limit),
          truncated: truncated || results.length > search.limit,
        },
      } as const;
    }
  }
  if (result._meta?.page != null) {
    const page = resourceReaders.page.schema.safeParse(result._meta.page);
    if (page.success) {
      return page.data;
    }
  }
  return launchSchema.safeParse(result.structuredContent).data;
}

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

  async search(input: SearchInput) {
    const result = await this.call({ name: 'search_hypermedia', args: input });
    return SearchHypermediaOutputSchema.parse(result.structuredContent);
  }

  async resource(address: string) {
    const kind = internalLink(address)?.kind;
    if (!kind || kind === 'record') {
      throw new Error('This resource cannot be previewed.');
    }
    const reader = resourceReaders[kind];
    const result = await this.call({ name: reader.tool, args: { address } });
    return reader.schema.parse(result.structuredContent);
  }

  async image(address: string) {
    const result = await this.call({ name: 'read_asset_image_preview', args: { address } });
    const { data, mimeType } = z
      .object({ mimeType: z.enum(['image/webp', 'image/gif']), data: z.string().min(1) })
      .parse(result._meta);
    return `data:${mimeType};base64,${data}`;
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
