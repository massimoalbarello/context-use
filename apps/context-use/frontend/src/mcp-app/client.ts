import type { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import { isEmbeddableAssetMedia } from '#backend/models/assets/presentation.ts';
import { McpAssetSchema, McpAssetTransferRequestSchema } from '#backend/routes/mcp/assets/model.ts';
import { PreviewAddressSchema } from '#backend/routes/mcp/coordinates.ts';
import { McpEntitySchema } from '#backend/routes/mcp/entities/model.ts';
import {
  KnowledgePageListOutputSchema,
  McpKnowledgePageSchema,
} from '#backend/routes/mcp/pages/model.ts';
import { internalLink } from '../lib/internal-link';
import type { CreatePageVariables } from '../queries/pages';

export type Entity = z.infer<typeof McpEntitySchema>;
export type Asset = z.infer<typeof McpAssetSchema>;
export type Page = z.infer<typeof McpKnowledgePageSchema>;

const resourceReaders = {
  page: {
    tool: 'read_knowledge_page',
    schema: McpKnowledgePageSchema.transform((value) => ({ kind: 'page', value }) as const),
  },
  entity: {
    tool: 'read_entity',
    schema: McpEntitySchema.transform((value) => ({ kind: 'entity', value }) as const),
  },
  asset: {
    tool: 'read_asset',
    schema: McpAssetSchema.transform((value) => ({ kind: 'asset', value }) as const),
  },
};

type ToolContent = Awaited<ReturnType<App['callServerTool']>>['content'];

function assetResult({ asset, content }: { asset: Asset; content?: ToolContent }) {
  const image = content?.find((block) => block.type === 'image');
  const imageSrc =
    image && isEmbeddableAssetMedia(image.mimeType)
      ? `data:${image.mimeType};base64,${image.data}`
      : undefined;
  return { kind: 'asset', value: asset, imageSrc } as const;
}

export function launchResource(result: {
  _meta?: Record<string, unknown>;
  structuredContent?: unknown;
}) {
  const meta = result._meta;
  const page = resourceReaders.page.schema.safeParse(meta?.page).data;
  return {
    address: page?.value.address ?? PreviewAddressSchema.safeParse(meta?.address).data,
    page,
  };
}

const ToolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export class McpToolError extends Error {
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

function toolFailure(result: { structuredContent?: unknown; isError?: boolean }) {
  const failure = ToolErrorSchema.safeParse(result.structuredContent);
  if (failure.success) {
    return new McpToolError(failure.data.error);
  }
  if (result.isError) {
    return new Error('The page operation failed. Try again.');
  }
  if (
    z
      .object({ code: z.literal('hypermedia_curation_guide_required') })
      .safeParse(result.structuredContent).success
  ) {
    return new Error('The curation guide changed. Try again to use the current guide.');
  }
}

export class McpAppClient {
  constructor(
    readonly app: Pick<App, 'callServerTool' | 'openLink' | 'setupSizeChangedNotifications'>,
  ) {}

  private async call({ name, args = {} }: { name: string; args?: Record<string, unknown> }) {
    const result = await this.app.callServerTool({ name, arguments: args });
    const failure = toolFailure(result);
    if (failure) {
      throw failure;
    }
    return result;
  }

  async resource(address: string) {
    const kind = internalLink(address)?.kind;
    if (!kind || kind === 'record') {
      throw new Error('This resource cannot be previewed.');
    }
    if (kind === 'asset') {
      return this.readAsset(address);
    }
    const reader = resourceReaders[kind];
    const result = await this.call({ name: reader.tool, args: { address } });
    return reader.schema.parse(result.structuredContent);
  }

  async mentioningPages({
    address,
    cursor,
    limit,
  }: {
    address: string;
    cursor: string | null;
    limit: number;
  }) {
    const result = await this.call({
      name: 'list_knowledge_pages',
      args: { mentioningEntity: address, limit, cursor: cursor ?? undefined },
    });
    return KnowledgePageListOutputSchema.parse(result.structuredContent);
  }

  async readAsset(address: string) {
    const result = await this.call({
      name: resourceReaders.asset.tool,
      args: { address, includePreview: true },
    });
    return assetResult({
      asset: McpAssetSchema.parse(result.structuredContent),
      content: result.content,
    });
  }

  async downloadAsset({ address, signal }: { address: string; signal: AbortSignal }) {
    const result = await this.call({
      name: resourceReaders.asset.tool,
      args: { address, includeDownload: true },
    });
    const { download } = z
      .object({ download: McpAssetTransferRequestSchema })
      .parse(result.structuredContent);
    if (download.method !== 'GET') {
      throw new Error('Invalid download request.');
    }
    const response = await fetch(download.url, {
      headers: download.requiredHeaders,
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new Error('Could not load this file.');
    }
    return { response, origin: new URL(download.url).origin };
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

export function initialNotice(result: { structuredContent?: unknown; isError?: boolean }) {
  const failure = toolFailure(result);
  if (failure) {
    return failure.message;
  }
  if (z.object({ archived: z.literal(true) }).safeParse(result.structuredContent).success) {
    return 'Page archived. You can restore it from the Archived filter in Context Use.';
  }
  return '';
}
