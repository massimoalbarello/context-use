import { assetKey } from '@context-use/open-sync/assets';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Deliverable, DeliveryResult, DestinationType } from '@context-use/open-sync/delivery';
import type { AssetImport } from '#backend/models/assets/model.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import { InvalidRecordAssetError } from '#backend/models/records/assets.ts';
import {
  type RecordInput,
  RecordInputSchema,
  RecordPublicationConflictError,
  type RecordSyncRevision,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';

import { importedAssetReadableId, mapRecordAssets } from './record-assets.ts';

// Validate all rewritten records before publishing any; each publication commits its own revision.
function deliveredRecords(input: {
  deliverable: Deliverable;
  provider: string;
  assets: ReadonlyMap<string, { readableId: string; name: string }>;
}) {
  const records = [];
  for (const record of input.deliverable.records) {
    if (record.operation !== 'upsert' || !record.content) {
      return null;
    }
    const parsed = RecordInputSchema.safeParse({
      source: { provider: input.provider, kind: record.kind, id: record.id },
      title: record.preview,
      body: mapRecordAssets({
        body: record.content.body,
        assetRefs: record.assetRefs ?? {},
        assets: input.assets,
      }),
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
  importAsset(input: {
    asset: AssetImport;
    read(): Promise<ReadableStream<Uint8Array>>;
    signal: AbortSignal;
    change: ChangeContext;
  }): Promise<
    | { state: 'ready'; readableId: string }
    | { state: 'conflict' }
    | { state: 'invalid'; message: string }
  >;
  upsertRecord(input: {
    ownerId: string;
    record: RecordInput;
    sync: RecordSyncRevision;
    change: ChangeContext;
  }): Promise<RecordWriteResult>;
  definitions: readonly SyncRegistration[];
}): DestinationType {
  async function publish({
    deliverable,
    provider,
    signal,
  }: {
    deliverable: Deliverable;
    provider: string;
    signal: AbortSignal;
  }): Promise<DeliveryResult> {
    const change = { clientName: provider, message: `Synced record from ${provider}` };
    const imported = new Map<string, { readableId: string; name: string }>();
    // Finish every asset before the first record. Replays reuse these immutable local assets.
    for (const asset of deliverable.assets) {
      signal.throwIfAborted();
      if ('unavailable' in asset) {
        return { status: 'rejected', code: 'asset_unavailable' };
      }
      const result = await input.importAsset({
        asset: {
          ownerId: deliverable.ownerId,
          readableId: importedAssetReadableId({ ...deliverable, asset }),
          name: asset.name,
          sizeBytes: asset.size,
          contentHash: asset.sha256,
        },
        read: () => deliverable.openAsset(asset),
        signal,
        change,
      });
      if (result.state === 'conflict') {
        return { status: 'rejected', code: 'asset_conflict' };
      }
      if (result.state === 'invalid') {
        return { status: 'rejected', code: 'unsupported_asset' };
      }
      imported.set(assetKey(asset), { readableId: result.readableId, name: asset.name });
    }
    return publishRecords({ deliverable, provider, assets: imported, signal, change });
  }
  async function publishRecords({
    deliverable,
    provider,
    assets,
    signal,
    change,
  }: {
    deliverable: Deliverable;
    provider: string;
    assets: ReadonlyMap<string, { readableId: string; name: string }>;
    signal: AbortSignal;
    change: ChangeContext;
  }): Promise<DeliveryResult> {
    let records: ReturnType<typeof deliveredRecords>;
    try {
      records = deliveredRecords({ deliverable, provider, assets });
    } catch {
      return { status: 'rejected', code: 'invalid_asset_reference' };
    }
    if (!records) {
      return { status: 'rejected', code: 'invalid_record' };
    }
    for (const { record, revision } of records) {
      signal.throwIfAborted();
      const result = await input.upsertRecord({
        ownerId: deliverable.ownerId,
        record,
        sync: { syncId: deliverable.syncId, revision },
        change,
      });
      if (result.state === 'conflict') {
        return { status: 'rejected', code: 'conflict' };
      }
    }
    signal.throwIfAborted();
    return { status: 'accepted' };
  }
  return {
    configSchema: { type: 'object', additionalProperties: false },
    async deliver({ deliverable, scope, signal }) {
      signal.throwIfAborted();
      const registration = input.definitions.find(
        ({ definition }) => definition.id === deliverable.definition,
      );
      const provider = registration?.definition.provider?.service;
      if (
        deliverable.ownerId !== scope.ownerId ||
        scope.ownerId !== input.ownerId ||
        !registration ||
        !provider ||
        !deliverable.syncId
      ) {
        return { status: 'rejected', code: 'invalid_source' };
      }
      try {
        return await publish({ deliverable, provider, signal });
      } catch (error) {
        if (error instanceof RecordPublicationConflictError) {
          return { status: 'rejected', code: 'publication_conflict' };
        }
        if (error instanceof InvalidRecordAssetError) {
          return { status: 'rejected', code: 'invalid_asset_reference' };
        }
        throw error;
      }
    },
  };
}
