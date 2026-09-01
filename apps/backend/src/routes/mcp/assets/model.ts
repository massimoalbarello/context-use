import { z } from 'zod';
import type { Asset, AssetSummary, AssetUsage } from '#models/assets/model.ts';
import { MAX_ASSET_BYTES } from '#models/assets/model.ts';
import { AssetAddressSchema, assetAddress, McpReadableIdSchema } from '#routes/mcp/coordinates.ts';
import { McpEntityReferenceSchema, mcpEntityReference } from '#routes/mcp/entities/model.ts';
import { McpKnowledgePageSummarySchema, mcpKnowledgePageSummary } from '#routes/mcp/pages/model.ts';

export const McpAssetSummarySchema = z.object({
  address: AssetAddressSchema,
  readableId: McpReadableIdSchema,
  name: z.string(),
  mediaType: z.string(),
  extension: z.string().nullable(),
  sizeBytes: z.number().int().min(1).max(MAX_ASSET_BYTES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const McpAssetUsageSchema = z.union([
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
  usages: z.array(McpAssetUsageSchema),
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
    usages: asset.usages.map(mcpAssetUsage),
  };
}
