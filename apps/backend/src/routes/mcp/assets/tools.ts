import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MAX_ASSET_NAME_LENGTH } from '#models/assets/model.ts';
import type { McpClientAuthorizationPrincipal } from '#models/mcp-client-authorizations/model.ts';
import {
  McpAssetSchema,
  McpAssetSummarySchema,
  McpAssetTransferRequestSchema,
  mcpAsset,
  mcpAssetSummary,
  mcpAssetUsage,
} from '#routes/mcp/assets/model.ts';
import type { AssetTransferCapabilitiesContract } from '#routes/mcp/assets/transfer-capabilities.ts';
import { MCP_ASSET_TRANSFER_CAPABILITY_HEADER } from '#routes/mcp/assets/transfer-capabilities.ts';
import { AssetAddressSchema, assetAddress, assetReadableId } from '#routes/mcp/coordinates.ts';
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
import type { AssetsServiceContract } from '#services/assets/service.ts';

const AssetNameSchema = z
  .string()
  .min(1)
  .max(MAX_ASSET_NAME_LENGTH)
  .regex(/.*\S.*/)
  .describe('Meaningful name for the asset; this is the complete editable representation');

const CreateAssetUploadInputSchema = z.object({
  name: AssetNameSchema,
  allowDuplicate: z
    .boolean()
    .optional()
    .describe('Retry with true only after a name-conflict result and a deliberate decision'),
});

const AssetAddressInputSchema = z.object({ address: AssetAddressSchema });

const ReadAssetInputSchema = AssetAddressInputSchema.extend({
  includeDownload: z
    .boolean()
    .optional()
    .describe('Set true only when the immutable asset bytes are needed'),
});

const UpdateAssetInputSchema = AssetAddressInputSchema.extend({ name: AssetNameSchema });

const AssetListOutputSchema = z.object({
  items: z.array(McpAssetSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

const CreateAssetUploadOutputSchema = McpAssetTransferRequestSchema.extend({
  method: z.literal('PUT'),
});

const ReadAssetOutputSchema = McpAssetSchema.extend({
  download: McpAssetTransferRequestSchema.extend({ method: z.literal('GET') }).nullable(),
});

const ArchiveAssetOutputSchema = z.object({
  archived: z.literal(true),
  address: AssetAddressSchema,
});

const UpdateAssetOutputSchema = z.object({});

const UPLOAD_INSTRUCTIONS =
  'Send the raw asset bytes as the request body. Do not base64-encode them or wrap them in JSON or multipart form data. Use this request once before expiresAt; its HTTP response is the final typed asset result.';
const DOWNLOAD_INSTRUCTIONS =
  'Send this exact GET request to the supplied URL with every required header once before expiresAt. Read the HTTP response body as raw asset bytes, not JSON or base64. Treat its Content-Type and Content-Disposition headers as authoritative.';

export function registerAssetTools({
  server,
  principal,
  assetsService,
  transferCapabilities,
}: {
  server: McpServer;
  principal: McpClientAuthorizationPrincipal;
  assetsService: AssetsServiceContract;
  transferCapabilities: AssetTransferCapabilitiesContract;
}): void {
  server.registerTool(
    'create_asset_upload',
    {
      title: 'Create asset upload',
      description:
        'Create a short-lived, single-use request for uploading one asset. Supply immutable bytes and a meaningful name. Do not infer unsupported identity, location, intent, or chronology from media content.',
      inputSchema: CreateAssetUploadInputSchema,
      outputSchema: CreateAssetUploadOutputSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    ({ name, allowDuplicate }) => {
      const upload = transferCapabilities.issueUpload({ principal, name, allowDuplicate });
      return mcpToolSuccess({
        method: 'PUT',
        url: upload.url,
        requiredHeaders: {
          'content-type': 'application/octet-stream',
          [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: upload.secret,
        },
        expiresAt: upload.expiresAt,
        instructions: UPLOAD_INSTRUCTIONS,
      });
    },
  );

  server.registerTool(
    'list_assets',
    {
      title: 'List assets',
      description:
        'List active asset metadata without searching. Pass nextCursor unchanged to continue the list; use meaningful names and do not infer unsupported facts from media metadata.',
      inputSchema: McpListInputSchema,
      outputSchema: AssetListOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ cursor, limit = DEFAULT_MCP_LIST_LIMIT }) => {
      const decoded = decodeMcpCursor({ cursor, list: 'assets' });
      if (decoded.state === 'invalid') {
        return mcpToolError({
          code: 'invalid_cursor',
          message: 'The asset-list cursor is invalid. Restart the list without a cursor.',
        });
      }
      const page = await assetsService.list({
        ownerId: principal.ownerId,
        limit,
        offset: decoded.offset,
      });
      return mcpToolSuccess({
        items: page.items.map(mcpAssetSummary),
        total: page.total,
        nextCursor: encodeMcpCursor({ list: 'assets', offset: page.nextOffset }),
      });
    },
  );

  server.registerTool(
    'read_asset',
    {
      title: 'Read asset',
      description:
        'Read metadata and usages for one active asset by its exact address. Asset bytes are immutable; request a short-lived download only when bytes are needed, and do not infer unsupported identity, location, intent, or chronology from them.',
      inputSchema: ReadAssetInputSchema,
      outputSchema: ReadAssetOutputSchema,
      annotations: MCP_READ_TOOL_ANNOTATIONS,
    },
    async ({ address, includeDownload = false }) => {
      const readableId = assetReadableId(address);
      const asset = await assetsService.detail({ ownerId: principal.ownerId, readableId });
      if (!asset) {
        return mcpToolError({ code: 'not_found', message: 'Asset not found.' });
      }
      const download = includeDownload
        ? transferCapabilities.issueDownload({ principal, readableId })
        : null;
      return mcpToolSuccess({
        ...mcpAsset(asset),
        download: download
          ? {
              method: 'GET',
              url: download.url,
              requiredHeaders: {
                [MCP_ASSET_TRANSFER_CAPABILITY_HEADER]: download.secret,
              },
              expiresAt: download.expiresAt,
              instructions: DOWNLOAD_INSTRUCTIONS,
            }
          : null,
      });
    },
  );

  server.registerTool(
    'update_asset',
    {
      title: 'Update asset',
      description:
        'Update the complete editable representation of one active asset, currently its meaningful name. The supplied bytes are immutable; create a new asset when content must change.',
      inputSchema: UpdateAssetInputSchema,
      outputSchema: UpdateAssetOutputSchema,
      annotations: MCP_WRITE_TOOL_ANNOTATIONS,
    },
    async ({ address, name }) => {
      const asset = await assetsService.updateName({
        ownerId: principal.ownerId,
        readableId: assetReadableId(address),
        name,
      });
      return asset
        ? mcpToolSuccess({})
        : mcpToolError({ code: 'not_found', message: 'Asset not found.' });
    },
  );

  server.registerTool(
    'archive_asset',
    {
      title: 'Archive asset',
      description:
        'Archive one asset without deleting its immutable bytes. This is destructive and succeeds only when no active page or entity-image usage blocks it.',
      inputSchema: AssetAddressInputSchema,
      outputSchema: ArchiveAssetOutputSchema,
      annotations: MCP_ARCHIVE_TOOL_ANNOTATIONS,
    },
    async ({ address }) => {
      const readableId = assetReadableId(address);
      const result = await assetsService.archive({ ownerId: principal.ownerId, readableId });
      if (result.state === 'not_found') {
        return mcpToolError({ code: 'not_found', message: 'Asset not found.' });
      }
      if (result.state === 'resource_in_use') {
        return mcpToolError({
          code: 'resource_in_use',
          message:
            'Archiving is blocked by active usages. Surface these blockers to the user; never remove usages or archive pages automatically.',
          details: { blockers: result.blockers.map(mcpAssetUsage) },
        });
      }
      return mcpToolSuccess({ archived: true, address: assetAddress(readableId) });
    },
  );
}
