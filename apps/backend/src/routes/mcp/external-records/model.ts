import { z } from 'zod';
import type {
  OpenConnectorSearchResult,
  StoredOpenConnectorRecord,
} from '#models/open-connector/model.ts';
import { ExternalRecordAddressSchema, externalRecordAddress } from '#routes/mcp/coordinates.ts';

const ExternalRecordIdentityShape = {
  address: ExternalRecordAddressSchema,
  provider: z.string(),
  sourceId: z.string(),
  kind: z.string(),
  recordId: z.string(),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  committedAt: z.string(),
};

export const McpExternalRecordSearchResultSchema = z.object({
  ...ExternalRecordIdentityShape,
  label: z.string(),
  matchExcerpt: z.string().nullable(),
});

const McpExternalRecordParticipantSchema = z.object({
  identities: z.array(
    z.object({
      namespace: z.string(),
      id: z.string(),
    }),
  ),
  roles: z.array(z.string()),
  name: z.string().optional(),
});

const McpExternalRecordContentSchema = z.object({
  body: z.string(),
  sourceUrl: z.string().optional(),
  sourceCreatedAt: z.string().optional(),
  sourceUpdatedAt: z.string().optional(),
  participants: z.array(McpExternalRecordParticipantSchema).optional(),
  attributes: z.record(z.string(), z.json()).optional(),
});

export const McpExternalRecordSchema = z.object({
  ...ExternalRecordIdentityShape,
  operation: z.enum(['added', 'updated']),
  content: McpExternalRecordContentSchema,
});

export function mcpExternalRecordSearchResult(result: OpenConnectorSearchResult) {
  return {
    address: externalRecordAddress(result),
    provider: result.provider,
    sourceId: result.sourceId,
    kind: result.kind,
    recordId: result.recordId,
    revision: result.revision,
    contentHash: result.contentHash,
    committedAt: result.committedAt,
    label: result.label,
    matchExcerpt: result.matchExcerpt,
  };
}

export function mcpExternalRecord(record: StoredOpenConnectorRecord) {
  if (record.operation === 'deleted' || !record.content) {
    throw new Error('Cannot expose a deleted external record');
  }
  return {
    address: externalRecordAddress(record),
    provider: record.provider,
    sourceId: record.sourceId,
    kind: record.kind,
    recordId: record.recordId,
    revision: record.revision,
    operation: record.operation,
    contentHash: record.contentHash,
    committedAt: record.committedAt,
    content: record.content,
  };
}
