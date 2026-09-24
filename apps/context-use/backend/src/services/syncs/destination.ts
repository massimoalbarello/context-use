import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Deliverable, DestinationType } from '@context-use/open-sync/delivery';
import { z } from 'zod';
import type { ChangeContext } from '#backend/models/history/model.ts';
import {
  type RecordInput,
  RecordInputSchema,
  type RecordSyncRevision,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';

// The current local destination stores readable summaries; captured attachments require a
// durable host asset mapping before this contract can accept them.
const summarySchema = z.object({ title: z.string(), url: z.string().optional() });

// Validate the complete batch before publishing; every publication commits its own revision.
function deliveredRecords(input: {
  deliverable: Deliverable;
  registration: SyncRegistration;
  provider: string;
}) {
  const records = [];
  for (const record of input.deliverable.records) {
    if (
      record.operation !== 'upsert' ||
      !Object.hasOwn(input.registration.definition.kinds, record.kind) ||
      !record.content ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1
    ) {
      return null;
    }
    const summary = summarySchema.safeParse(record.data);
    if (!summary.success) {
      return null;
    }
    const parsed = RecordInputSchema.safeParse({
      source: { provider: input.provider, kind: record.kind, id: record.id, url: summary.data.url },
      title: summary.data.title,
      body: record.content.body,
      occurredAt: record.createdAt,
      sourceCreatedAt: record.createdAt,
      sourceUpdatedAt: record.updatedAt,
    });
    if (!parsed.success) {
      return null;
    }
    records.push({ record: parsed.data, revision: record.revision });
  }
  return records;
}

export function localRecordDestination(input: {
  ownerId: string;
  upsertRecord(input: {
    ownerId: string;
    record: RecordInput;
    sync: RecordSyncRevision;
    change: ChangeContext;
  }): Promise<RecordWriteResult>;
  definitions: readonly SyncRegistration[];
}): DestinationType {
  return {
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ deliverable, scope, signal }) {
      signal.throwIfAborted();
      const registration = input.definitions.find(
        ({ definition }) => definition.id === deliverable.definition,
      );
      if (
        deliverable.ownerId !== scope.ownerId ||
        scope.ownerId !== input.ownerId ||
        !registration ||
        !deliverable.syncId
      ) {
        return { status: 'rejected', code: 'invalid_source' };
      }
      if (
        deliverable.assets.length ||
        deliverable.records.some(
          (record) => record.operation === 'upsert' && Object.keys(record.assetRefs ?? {}).length,
        )
      ) {
        return { status: 'rejected', code: 'unsupported_assets' };
      }
      const provider = registration.definition.provider?.service;
      if (!provider) {
        return { status: 'rejected', code: 'invalid_source' };
      }
      const records = deliveredRecords({ deliverable, registration, provider });
      if (!records) {
        return { status: 'rejected', code: 'invalid_record' };
      }
      for (const { record, revision } of records) {
        signal.throwIfAborted();
        const result = await input.upsertRecord({
          ownerId: scope.ownerId,
          record,
          sync: { syncId: deliverable.syncId, revision },
          change: { clientName: provider, message: `Synced record from ${provider}` },
        });
        if (result.state === 'conflict') {
          return { status: 'rejected', code: 'conflict' };
        }
      }
      signal.throwIfAborted();
      return { status: 'accepted' };
    },
  };
}
