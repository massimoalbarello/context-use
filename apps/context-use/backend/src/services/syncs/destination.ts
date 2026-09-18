import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Delivery, DestinationType } from '@context-use/open-sync/delivery';
import {
  type RecordInput,
  RecordInputSchema,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';

function deliveredRecords(input: {
  delivery: Delivery;
  registration: SyncRegistration;
}): RecordInput[] | null {
  const records: RecordInput[] = [];
  const definition = input.registration.definition;
  for (const record of input.delivery.deliverable.records) {
    if (record.operation !== 'upsert' || !Object.hasOwn(definition.kinds, record.kind)) {
      return null;
    }
    const parsed = RecordInputSchema.safeParse(record.data);
    if (!parsed.success) {
      return null;
    }
    const source = parsed.data.source;
    if (
      source.provider !== definition.provider?.service ||
      source.kind !== record.kind ||
      source.id !== record.id
    ) {
      return null;
    }
    records.push(parsed.data);
  }
  return records;
}

export function localRecordDestination(input: {
  ownerId: string;
  upsertRecord(input: { ownerId: string; record: RecordInput }): Promise<RecordWriteResult>;
  definitions: readonly SyncRegistration[];
}): DestinationType {
  return {
    version: '1',
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ delivery, scope, signal }) {
      signal.throwIfAborted();
      const registration = input.definitions.find(
        ({ definition }) =>
          definition.id === delivery.definition.id &&
          definition.version === delivery.definition.version &&
          definition.artifactId === delivery.definition.artifactId,
      );
      if (delivery.ownerId !== scope.ownerId || scope.ownerId !== input.ownerId || !registration) {
        return { status: 'rejected', code: 'invalid_source' };
      }
      const records = deliveredRecords({ delivery, registration });
      if (!records) {
        return { status: 'rejected', code: 'invalid_record' };
      }
      for (const record of records) {
        signal.throwIfAborted();
        const result = await input.upsertRecord({ ownerId: scope.ownerId, record });
        if (result.state === 'conflict') {
          return { status: 'rejected', code: 'conflict' };
        }
      }
      return { status: 'accepted' };
    },
  };
}
