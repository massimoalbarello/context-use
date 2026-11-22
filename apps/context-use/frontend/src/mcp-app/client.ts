import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import { McpAssetSchema } from '#backend/routes/mcp/assets/model.ts';
import { McpEntityDetailSchema } from '#backend/routes/mcp/entities/detail-model.ts';
import { McpKnowledgePageSchema } from '#backend/routes/mcp/pages/model.ts';
import { WidgetSearchSchema } from '#backend/routes/mcp/pages/search-model.ts';
import { internalLink } from '../lib/internal-link';
import type { CreatePageVariables } from '../queries/pages';

export type WidgetSearch = z.infer<typeof WidgetSearchSchema>;
export type Entity = z.infer<typeof McpEntityDetailSchema>;
export type Asset = z.infer<typeof McpAssetSchema>;
export function launchResource(result: { structuredContent?: unknown }) {
  const search = WidgetSearchSchema.safeParse(result.structuredContent);
  if (search.success) {
    return { kind: 'search', data: search.data } as const;
  }
  const entity = McpEntityDetailSchema.safeParse(result.structuredContent);
  if (entity.success) {
    return { kind: 'entity', data: entity.data } as const;
  }
  const asset = McpAssetSchema.safeParse(result.structuredContent);
  if (asset.success) {
    return { kind: 'asset', data: asset.data } as const;
  }
  return null;
}
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

  async search(input: Pick<WidgetSearch, 'query' | 'resourceType'>) {
    const result = await this.call({ name: 'open_resource_search', args: input });
    return WidgetSearchSchema.parse(result.structuredContent);
  }

  async resource(address: string) {
    switch (internalLink(address)?.kind) {
      case 'entity':
        return { kind: 'entity', value: await this.entity(address) } as const;
      case 'asset':
        return { kind: 'asset', value: await this.asset(address) } as const;
      case 'page':
        return { kind: 'page', value: await this.read(address) } as const;
      default:
        throw new Error('This resource cannot be previewed.');
    }
  }

  private async entity(address: string) {
    const result = await this.call({ name: 'read_entity', args: { address } });
    return McpEntityDetailSchema.parse(result.structuredContent);
  }

  private async asset(address: string) {
    const result = await this.call({ name: 'read_asset', args: { address } });
    return McpAssetSchema.parse(result.structuredContent);
  }

  async image(address: string) {
    const result = await this.call({ name: 'read_asset_image_preview', args: { address } });
    const { data, mimeType } = z
      .object({ mimeType: z.enum(['image/webp', 'image/gif']), data: z.string().min(1) })
      .parse(result._meta);
    return `data:${mimeType};base64,${data}`;
  }

  private async read(address: string) {
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
