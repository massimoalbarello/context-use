import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema } from '#lib/errors.ts';
import type { ImportedAsset } from '#models/assets/import.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#models/assets/model.ts';
import { assetAddress } from '#models/readable-ids/addresses.ts';
import type { RecordSyncPrincipal } from '#models/syncs/model.ts';
import { authenticateSyncRequest, RECORD_SYNC_SECURITY_SCHEME } from '#routes/sync-auth.ts';
import type { AssetImportsServiceContract } from '#services/assets/imports.ts';
import type { RecordSyncAuthenticationContract } from '#services/syncs/service.ts';

const params = t.Object({ key: t.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }) });
const assetSchema = t.Object({
  assetId: t.String(),
  url: t.String(),
  sha256: t.String(),
  sizeBytes: t.Number(),
});

function response(asset: ImportedAsset) {
  return {
    assetId: asset.assetId,
    url: assetAddress(asset.assetId),
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
  };
}

export function createAssetImportsController({
  assetImportsService,
  syncsService,
}: {
  assetImportsService: AssetImportsServiceContract;
  syncsService: RecordSyncAuthenticationContract;
}) {
  const principals = new WeakMap<Request, RecordSyncPrincipal>();
  return new Elysia({ prefix: '/api/assets/imports' })
    .onRequest(async ({ request, status }) => {
      if (
        !/\/api\/assets\/imports\/[^/]+$/u.test(new URL(request.url).pathname) ||
        !['GET', 'PUT'].includes(request.method)
      ) {
        return;
      }
      const principal = await authenticateSyncRequest({ request, syncs: syncsService });
      if (!principal) {
        return status(StatusMap.Unauthorized, { error: 'Unauthorized' });
      }
      principals.set(request, principal);
    })
    .get(
      '/:key',
      async ({ params, request, status }) => {
        const asset = await assetImportsService.find({
          ...principals.get(request)!,
          key: params.key,
        });
        if (asset?.archived) {
          return status(StatusMap.Conflict, { error: 'Asset has been archived' });
        }
        return asset
          ? response(asset)
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        params,
        response: {
          200: assetSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
        detail: {
          tags: ['Assets'],
          summary: 'Find a completed sync asset upload',
          security: [{ [RECORD_SYNC_SECURITY_SCHEME]: [] }],
        },
      },
    )
    .put(
      '/:key',
      async ({ params, body, request, status }) => {
        const result = await assetImportsService.upload({
          ...principals.get(request)!,
          key: params.key,
          ...body,
        });
        if (result.state === 'ready') {
          return response(result.asset);
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: result.message });
        }
        if (result.state === 'inactive_sync') {
          return status(StatusMap.Unauthorized, { error: 'Unauthorized' });
        }
        return status(StatusMap.Conflict, {
          error: 'Asset key identifies different content or an archived asset',
        });
      },
      {
        params,
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: MAX_ASSET_NAME_LENGTH }),
          sha256: t.String({ pattern: '^[a-f0-9]{64}$' }),
          file: t.File({ maxSize: MAX_ASSET_BYTES }),
        }),
        response: {
          200: assetSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
        detail: {
          tags: ['Assets'],
          summary: 'Upload an asset independently using a stable sync key',
          security: [{ [RECORD_SYNC_SECURITY_SCHEME]: [] }],
        },
      },
    );
}
