import { t } from 'elysia';
import type { Asset, AssetSummary, AssetUsage } from '#backend/models/assets/model.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
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
  t.Object({
    kind: t.Literal('record'),
    record: t.Object({
      readableId: ReadableIdSchema,
      title: t.String(),
      source: t.Object({ provider: t.String(), kind: t.String() }),
    }),
    presentation: t.Union([t.Literal('embed'), t.Literal('attachment')]),
  }),
  KnowledgePageAssetUsageSchema,
  EntityImageAssetUsageSchema,
]);

export const AssetResourceInUseResponseSchema = t.Object({
  error: t.String(),
  blockers: t.Array(AssetUsageSchema),
});

export const AssetSchema = t.Object({
  ...AssetSummarySchema.properties,
  usages: t.Array(AssetUsageSchema),
  depicts: t.Array(
    t.Object({
      entity: EntityReferenceSchema,
      source: t.Union([t.Literal('detected'), t.Literal('confirmed')]),
    }),
  ),
});

export const AssetPreviewSchema = t.Pick(AssetSummarySchema, [
  'readableId',
  'name',
  'mediaType',
  'extension',
  'sizeBytes',
]);

export function assetPreviewResponse(asset: AssetSummary) {
  return {
    readableId: asset.readableId,
    name: asset.name,
    mediaType: asset.mediaType,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
  };
}

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
    return {
      kind: usage.kind,
      record: {
        readableId: usage.record.readableId,
        title: usage.record.title,
        source: usage.record.source,
      },
      presentation: usage.presentation,
    };
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
    usages: asset.usages.map(assetUsageResponse),
    depicts: asset.depicts.map(({ entity, source }) => ({
      entity: entityReferenceResponse(entity),
      source,
    })),
  };
}
