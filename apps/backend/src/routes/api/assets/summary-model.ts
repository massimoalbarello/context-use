import { t } from 'elysia';
import type { AssetSummary } from '#models/assets/model.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#models/assets/model.ts';
import { ReadableIdSchema } from '#routes/api/model.ts';

export const AssetSummarySchema = t.Object({
  id: t.String({ format: 'uuid' }),
  readableId: ReadableIdSchema,
  name: t.String({ minLength: 1, maxLength: MAX_ASSET_NAME_LENGTH }),
  mediaType: t.String(),
  extension: t.Nullable(t.String()),
  sizeBytes: t.Integer({ minimum: 1, maximum: MAX_ASSET_BYTES }),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export function assetSummaryResponse(asset: AssetSummary) {
  return {
    ...asset,
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  };
}
