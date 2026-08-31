import { t } from 'elysia';
import type { Asset, AssetUsage } from '#models/assets/model.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#models/assets/model.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import {
  PaginationMetadataSchema,
  PaginationQuerySchema,
  ReadableIdSchema,
} from '#routes/api/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';

export const AssetUsageSchema = t.Object({
  page: KnowledgePageSummarySchema,
  presentation: t.Union([t.Literal('embed'), t.Literal('attachment')]),
});

export const AssetSchema = t.Object({
  ...AssetSummarySchema.properties,
  usages: t.Array(AssetUsageSchema),
});

export const AssetListSchema = t.Object({
  items: t.Array(AssetSummarySchema),
  ...PaginationMetadataSchema.properties,
});

export const AssetListQuerySchema = t.Object({
  ...PaginationQuerySchema.properties,
  query: t.Optional(t.String({ maxLength: MAX_ASSET_NAME_LENGTH })),
});

export const CreateAssetBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_ASSET_NAME_LENGTH }),
  file: t.File({ minSize: 1, maxSize: MAX_ASSET_BYTES }),
  allowDuplicate: t.Optional(t.Boolean()),
});

export const UpdateAssetBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_ASSET_NAME_LENGTH }),
});

export const AssetParamsSchema = t.Object({ assetReadableId: ReadableIdSchema });

export const AssetContentQuerySchema = t.Object({
  download: t.Optional(t.Literal('true')),
});

export function assetUsageResponse(usage: AssetUsage) {
  return { page: pageSummaryResponse(usage.page), presentation: usage.presentation };
}

export function assetResponse(asset: Asset) {
  return { ...assetSummaryResponse(asset), usages: asset.usages.map(assetUsageResponse) };
}
