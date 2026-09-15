import { z } from 'zod';
import type { Asset, AssetSummary, AssetUsage } from '#backend/models/assets/model.ts';
import { ASSET_ORIGINS, MAX_ASSET_BYTES } from '#backend/models/assets/model.ts';
import { assetAddress, recordAddress } from '#backend/models/readable-ids/addresses.ts';
import { MAX_SYNC_NAME_LENGTH } from '#backend/models/syncs/model.ts';
import {
  AssetAddressSchema,
  McpReadableIdSchema,
  RecordAddressSchema,
} from '#backend/routes/mcp/coordinates.ts';
import {
  McpEntityReferenceSchema,
  mcpEntityReference,
} from '#backend/routes/mcp/entities/model.ts';
import {
  McpKnowledgePageSummarySchema,
  mcpKnowledgePageSummary,
} from '#backend/routes/mcp/pages/model.ts';

export const McpAssetSummarySchema = z.object({
  address: AssetAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  mediaType: z.string(),
  extension: z.string().nullable(),
  sizeBytes: z.number().int().min(0).max(MAX_ASSET_BYTES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const McpAssetUsageSchema = z.union([
  z.object({
    kind: z.literal('record'),
    record: z.object({
      address: RecordAddressSchema,
      readableId: McpReadableIdSchema,
      title: z.string(),
      provider: z.string(),
      kind: z.string(),
    }),
  }),
  z.object({
    kind: z.literal('page'),
    page: McpKnowledgePageSummarySchema,
    presentation: z.union([z.literal('embed'), z.literal('attachment')]),
  }),
  z.object({
    kind: z.literal('entity_image'),
    entity: McpEntityReferenceSchema,
  }),
]);

export const McpAssetSchema = McpAssetSummarySchema.extend({
  origin: z.enum(ASSET_ORIGINS),
  sync: z
    .object({
      readableId: McpReadableIdSchema,
      name: z.string().min(1).max(MAX_SYNC_NAME_LENGTH),
    })
    .nullable(),
  usages: z.array(McpAssetUsageSchema),
  depicts: z.array(
    z.object({ entity: McpEntityReferenceSchema, source: z.enum(['detected', 'confirmed']) }),
  ),
});

export const McpAssetTransferRequestSchema = z.object({
  method: z.union([z.literal('GET'), z.literal('PUT')]),
  url: z.url(),
  requiredHeaders: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
  instructions: z.string(),
});

export function mcpAssetSummary(asset: AssetSummary) {
  return {
    address: assetAddress(asset.readableId),
    readableId: asset.readableId,
    name: asset.name,
    mediaType: asset.mediaType,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function mcpAssetUsage(usage: AssetUsage) {
  if (usage.kind === 'record') {
    return {
      kind: usage.kind,
      record: { ...usage.record, address: recordAddress(usage.record.readableId) },
    };
  }
  return usage.kind === 'page'
    ? {
        kind: usage.kind,
        page: mcpKnowledgePageSummary(usage.page),
        presentation: usage.presentation,
      }
    : { kind: usage.kind, entity: mcpEntityReference(usage.entity) };
}

export function mcpAsset(asset: Asset) {
  return {
    ...mcpAssetSummary(asset),
    origin: asset.origin,
    sync: asset.sync,
    usages: asset.usages.map(mcpAssetUsage),
    depicts: asset.depicts.map(({ entity, source }) => ({
      entity: mcpEntityReference(entity),
      source,
    })),
  };
}
