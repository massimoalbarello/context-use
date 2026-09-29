import { t } from 'elysia';
import type { AssetSummary } from '#backend/models/assets/model.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';

import { PublicationSchema } from '#backend/routes/api/publications/model.ts';

export const AssetSummarySchema = t.Object({
  preview: t.Optional(
    t.Object({ width: t.Integer({ minimum: 1 }), height: t.Integer({ minimum: 1 }) }),
  ),
  publishedAt: PublicationSchema.properties.publishedAt,
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
    preview: asset.preview
      ? { width: asset.preview.width, height: asset.preview.height }
      : undefined,
    publishedAt: asset.publishedAt,
    readableId: asset.readableId,
    name: asset.name,
    mediaType: asset.mediaType,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  };
}
