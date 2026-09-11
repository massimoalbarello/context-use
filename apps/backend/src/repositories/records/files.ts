import canonicalize from 'canonicalize';
import { z } from 'zod';
import type { Storage } from '#lib/storage/storage.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { DeliveredRecordSchema } from '#models/records/delivery-schema.generated.ts';
import type { AcceptedRecord, AcceptRecordsInput } from './contract.ts';

const CanonicalRecordSchema = z.strictObject({
  version: z.literal(1),
  ownerId: z.string().min(1),
  syncId: z.string().min(1),
  readableId: z.string().min(1),
  receivedAt: z.string().min(1),
  record: DeliveredRecordSchema,
});

export type RecordFileReference = {
  ownerId: string;
  syncId: string;
  sourceId: string;
  kind: string;
  recordId: string;
  readableId: string;
  revision: number;
  operation: DeliveredRecord['operation'];
  revisionHash: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
};

function hash(value: string | Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function revisionHash(record: DeliveredRecord): string {
  // Event identity belongs to delivery. All source metadata belongs to the revision.
  const { eventId: _eventId, ...revision } = record;
  return hash(canonicalize(revision)!);
}

export class RecordFiles {
  constructor(private readonly storage: Storage) {}

  async stage({
    input,
    accepted,
    attemptedKeys,
  }: {
    input: AcceptRecordsInput;
    accepted: AcceptedRecord;
    attemptedKeys: Set<string>;
  }): Promise<RecordFileReference> {
    const snapshot = CanonicalRecordSchema.parse({
      version: 1,
      ownerId: input.ownerId,
      syncId: input.syncId,
      readableId: accepted.readableId,
      receivedAt: input.receivedAt,
      record: accepted.record,
    });
    const storageKey = `${encodeURIComponent(input.ownerId)}/records/${encodeURIComponent(input.syncId)}/${encodeURIComponent(accepted.readableId)}/${Bun.randomUUIDv7()}.json`;
    const json = JSON.stringify(snapshot);
    const reference: RecordFileReference = {
      ownerId: input.ownerId,
      syncId: input.syncId,
      sourceId: snapshot.record.sourceId,
      kind: snapshot.record.kind,
      recordId: snapshot.record.id,
      readableId: accepted.readableId,
      revision: snapshot.record.revision,
      operation: snapshot.record.operation,
      revisionHash: revisionHash(snapshot.record),
      storageKey,
      contentHash: hash(json),
      sizeBytes: Buffer.byteLength(json, 'utf8'),
    };
    // Register before writing: even a rejected write may have created a partial file.
    attemptedKeys.add(storageKey);
    await this.storage.write(storageKey, new Blob([json], { type: 'application/json' }));
    await this.read(reference);
    return reference;
  }

  async read(reference: RecordFileReference): Promise<DeliveredRecord> {
    if (!(await this.storage.exists(reference.storageKey))) {
      throw new Error(`Record file ${reference.readableId} is missing`);
    }
    const bytes = new Uint8Array(await this.storage.file(reference.storageKey).arrayBuffer());
    if (bytes.byteLength !== reference.sizeBytes || hash(bytes) !== reference.contentHash) {
      throw new Error(`Record file ${reference.readableId} failed its integrity check`);
    }
    const snapshot = CanonicalRecordSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    const { record } = snapshot;
    if (
      snapshot.ownerId !== reference.ownerId ||
      snapshot.syncId !== reference.syncId ||
      snapshot.readableId !== reference.readableId ||
      record.sourceId !== reference.sourceId ||
      record.kind !== reference.kind ||
      record.id !== reference.recordId ||
      record.revision !== reference.revision ||
      record.operation !== reference.operation ||
      revisionHash(record) !== reference.revisionHash
    ) {
      throw new Error(`Record file ${reference.readableId} does not match its catalog entry`);
    }
    return record;
  }

  // Only discard this attempt's unpublished files. Unreferenced files can also be retained
  // committed revisions, so a crash-recovery scan cannot safely delete them all.
  async discard(keys: Iterable<string>): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(keys, async (key) => {
        if (await this.storage.exists(key)) {
          await this.storage.delete(key);
        }
      }),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Could not remove unpublished record files',
      );
    }
  }
}
