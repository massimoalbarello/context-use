import { Elysia, StatusMap, t } from 'elysia';
import { MAX_ASSET_BYTES } from '#models/assets/model.ts';
import { assetContentResponse } from '#routes/asset-content-response.ts';
import { McpAssetSchema, mcpAsset } from '#routes/mcp/assets/model.ts';
import {
  type AssetTransferCapabilitiesContract,
  MCP_ASSET_DOWNLOAD_ROUTE_PATH,
  MCP_ASSET_TRANSFER_CAPABILITY_HEADER,
  MCP_ASSET_UPLOAD_ROUTE_PATH,
} from '#routes/mcp/assets/transfer-capabilities.ts';
import type { AssetsServiceContract } from '#services/assets/service.ts';

const ASSET_UPLOAD_MEDIA_TYPE = 'application/octet-stream';
const MAX_REQUEST_ID_LENGTH = 512;

const CapabilityParamsSchema = t.Object({
  requestId: t.String({ minLength: 1, maxLength: MAX_REQUEST_ID_LENGTH }),
});

const TransferErrorSchema = t.Object({
  error: t.Object({ code: t.String(), message: t.String() }),
});

const UploadConflictSchema = t.Object({
  error: t.Object({
    code: t.Literal('asset_name_conflict'),
    message: t.String(),
    allowDuplicateRetryAvailable: t.Literal(true),
  }),
});

function transferError({ code, message }: { code: string; message: string }) {
  return { error: { code, message } };
}

async function uploadBlob({
  request,
}: {
  request: Request;
}): Promise<{ state: 'accepted'; blob: Blob } | { state: 'too_large' }> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES) {
    return { state: 'too_large' };
  }
  if (!request.body) {
    return { state: 'accepted', blob: new Blob([]) };
  }

  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > MAX_ASSET_BYTES) {
        await reader.cancel();
        return { state: 'too_large' };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { state: 'accepted', blob: new Blob([bytes], { type: ASSET_UPLOAD_MEDIA_TYPE }) };
}

export function createAssetTransferController({
  assetsService,
  transferCapabilities,
}: {
  assetsService: AssetsServiceContract;
  transferCapabilities: AssetTransferCapabilitiesContract;
}) {
  return new Elysia()
    .put(
      MCP_ASSET_UPLOAD_ROUTE_PATH,
      async ({ params, request, set, status }) => {
        set.headers['cache-control'] = 'no-store';
        const consumed = transferCapabilities.consumeUpload({
          requestId: params.requestId,
          secret: request.headers.get(MCP_ASSET_TRANSFER_CAPABILITY_HEADER) ?? '',
        });
        if (consumed.state === 'invalid') {
          return status(
            StatusMap['Not Found'],
            transferError({
              code: 'invalid_transfer_capability',
              message: 'The upload request is invalid, expired, or has already been used.',
            }),
          );
        }
        if (request.headers.get('content-type')?.toLowerCase() !== ASSET_UPLOAD_MEDIA_TYPE) {
          return status(
            StatusMap['Unsupported Media Type'],
            transferError({
              code: 'invalid_upload_media_type',
              message: `Use the required Content-Type: ${ASSET_UPLOAD_MEDIA_TYPE}.`,
            }),
          );
        }
        const body = await uploadBlob({ request });
        if (body.state === 'too_large') {
          return status(
            StatusMap['Payload Too Large'],
            transferError({
              code: 'asset_too_large',
              message: `Assets must be no larger than ${MAX_ASSET_BYTES} bytes.`,
            }),
          );
        }

        const { principal, name, allowDuplicate } = consumed.capability;
        const result = await assetsService.create({
          ownerId: principal.ownerId,
          name,
          file: body.blob,
          allowDuplicate,
        });
        if (result.state === 'created') {
          return status(StatusMap.Created, mcpAsset(result.asset));
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, {
            error: {
              code: 'asset_name_conflict' as const,
              message:
                'An asset with this name already exists. Use a more specific name, or create another upload with allowDuplicate only after deciding the duplicate is intentional.',
              allowDuplicateRetryAvailable: true as const,
            },
          });
        }
        return status(
          StatusMap['Bad Request'],
          transferError({ code: 'invalid_asset', message: result.message }),
        );
      },
      {
        parse: 'none',
        params: CapabilityParamsSchema,
        response: {
          [StatusMap.Created]: McpAssetSchema,
          [StatusMap['Bad Request']]: TransferErrorSchema,
          [StatusMap['Not Found']]: TransferErrorSchema,
          [StatusMap.Conflict]: UploadConflictSchema,
          [StatusMap['Payload Too Large']]: TransferErrorSchema,
          [StatusMap['Unsupported Media Type']]: TransferErrorSchema,
        },
        detail: { hide: true },
      },
    )
    .get(
      MCP_ASSET_DOWNLOAD_ROUTE_PATH,
      async ({ params, request }) => {
        const consumed = transferCapabilities.consumeDownload({
          requestId: params.requestId,
          secret: request.headers.get(MCP_ASSET_TRANSFER_CAPABILITY_HEADER) ?? '',
        });
        if (consumed.state === 'invalid') {
          return new Response(
            JSON.stringify(
              transferError({
                code: 'invalid_transfer_capability',
                message: 'The download request is invalid, expired, or has already been used.',
              }),
            ),
            {
              status: StatusMap['Not Found'],
              headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
            },
          );
        }
        const content = await assetsService.content({
          ownerId: consumed.capability.principal.ownerId,
          readableId: consumed.capability.readableId,
        });
        if (!content) {
          return new Response(
            JSON.stringify(transferError({ code: 'not_found', message: 'Asset not found.' })),
            {
              status: StatusMap['Not Found'],
              headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
            },
          );
        }
        return assetContentResponse({ asset: content.asset, blob: content.blob, inline: false });
      },
      {
        params: CapabilityParamsSchema,
        response: {
          [StatusMap.OK]: t.File(),
          [StatusMap['Not Found']]: TransferErrorSchema,
        },
        detail: { hide: true },
      },
    );
}
