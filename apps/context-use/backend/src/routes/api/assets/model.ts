import { t } from 'elysia';
import type { Asset, AssetUsage } from '#backend/models/assets/model.ts';
import {
  ASSET_ORIGINS,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
} from '#backend/models/assets/model.ts';
import {
  AssetSummarySchema,
  assetSummaryResponse,
} from '#backend/routes/api/assets/summary-model.ts';
import {
  EntityReferenceSchema,
  entityReferenceResponse,
} from '#backend/routes/api/entities/model.ts';
import {
  PaginationMetadataSchema,
  PaginationQuerySchema,
  ReadableIdSchema,
} from '#backend/routes/api/model.ts';
import {
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#backend/routes/api/pages/model.ts';
import { RecordSummarySchema } from '#backend/routes/api/records/model.ts';
import { RecordSyncReferenceSchema } from '#backend/routes/api/syncs/model.ts';

export const KnowledgePageAssetUsageSchema = t.Object({
  kind: t.Literal('page'),
  page: KnowledgePageSummarySchema,
  presentation: t.Union([t.Literal('embed'), t.Literal('attachment')]),
});

export const EntityImageAssetUsageSchema = t.Object({
  kind: t.Literal('entity_image'),
  entity: EntityReferenceSchema,
});

export const AssetUsageSchema = t.Union([
  KnowledgePageAssetUsageSchema,
  EntityImageAssetUsageSchema,
  t.Object({
    kind: t.Literal('record'),
    record: t.Pick(RecordSummarySchema, ['readableId', 'title', 'provider', 'kind']),
  }),
]);

export const AssetResourceInUseResponseSchema = t.Object({
  error: t.String(),
  blockers: t.Array(AssetUsageSchema),
});

export const AssetSchema = t.Object({
  origin: t.UnionEnum(ASSET_ORIGINS),
  sync: t.Nullable(RecordSyncReferenceSchema),
  ...AssetSummarySchema.properties,
  usages: t.Array(AssetUsageSchema),
  depicts: t.Array(
    t.Object({
      entity: EntityReferenceSchema,
      source: t.Union([t.Literal('detected'), t.Literal('confirmed')]),
    }),
  ),
});

export const AssetListSchema = t.Object({
  items: t.Array(AssetSummarySchema),
  ...PaginationMetadataSchema.properties,
});

export const AssetListQuerySchema = t.Object({
  ...PaginationQuerySchema.properties,
  kind: t.Optional(t.Literal('entity_image')),
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
  if (usage.kind === 'record') {
    return { kind: usage.kind, record: usage.record };
  }
  return usage.kind === 'page'
    ? {
        kind: usage.kind,
        page: pageSummaryResponse(usage.page),
        presentation: usage.presentation,
      }
    : { kind: usage.kind, entity: entityReferenceResponse(usage.entity) };
}

export function assetResponse(asset: Asset) {
  return {
    ...assetSummaryResponse(asset),
    origin: asset.origin,
    sync: asset.sync,
    usages: asset.usages.map(assetUsageResponse),
    depicts: asset.depicts.map(({ entity, source }) => ({
      entity: entityReferenceResponse(entity),
      source,
    })),
  };
}
