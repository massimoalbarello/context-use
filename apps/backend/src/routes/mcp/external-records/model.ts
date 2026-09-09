import { z } from 'zod';
import type { RecordSearchResult, StoredRecord } from '#models/records/model.ts';
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

const McpExternalRecordContentSchema = z.object({
  body: z.string(),
});

export const McpExternalRecordSchema = z.object({
  ...ExternalRecordIdentityShape,
  operation: z.enum(['added', 'updated']),
  content: McpExternalRecordContentSchema,
});

export function mcpExternalRecordSearchResult(result: RecordSearchResult) {
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

export function mcpExternalRecord(record: StoredRecord) {
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
    content: { body: record.content.body },
  };
}
