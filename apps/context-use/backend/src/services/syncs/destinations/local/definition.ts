import { assetKey } from '@context-use/open-sync/assets';
import type { SyncRegistration } from '@context-use/open-sync/definition';
import type { Deliverable, DeliveryResult, DestinationType } from '@context-use/open-sync/delivery';
import {
  type AssetImport,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
} from '#backend/models/assets/model.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import { InvalidRecordAssetError } from '#backend/models/records/assets.ts';
import {
  type RecordInput,
  RecordInputSchema,
  type RecordSyncRevision,
  type RecordWriteResult,
} from '#backend/models/records/model.ts';

import { importedAssetReadableId, mapRecordAssets } from './record-assets.ts';

// Validate all rewritten records before publishing any; each publication commits its own revision.
function deliveredRecords(input: {
  deliverable: Deliverable;
  registration: SyncRegistration;
  provider: string;
  assets: ReadonlyMap<string, { readableId: string; name: string }>;
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

class InvalidDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function deliveredAssets(deliverable: Deliverable) {
  const assets = new Map<string, AssetImport>();
  for (const asset of deliverable.assets) {
    if ('unavailable' in asset) {
      throw new InvalidDeliveryError('asset_unavailable');
    }
    const name = asset.name.trim();
    if (
      !name ||
      name.length > MAX_ASSET_NAME_LENGTH ||
      asset.size < 1 ||
      asset.size > MAX_ASSET_BYTES
    ) {
      throw new InvalidDeliveryError('unsupported_asset');
    }
    assets.set(assetKey(asset), {
      ownerId: deliverable.ownerId,
      readableId: importedAssetReadableId({ ...deliverable, asset }),
      name,
      sizeBytes: asset.size,
      contentHash: asset.sha256,
    });
  }
  return assets;
}

export function localRecordDestination(input: {
  ownerId: string;
  importAsset(input: {
    asset: AssetImport;
    read(): Promise<ReadableStream<Uint8Array>>;
    signal: AbortSignal;
    change: ChangeContext;
  }): Promise<{ state: 'ready'; readableId: string } | { state: 'conflict' }>;
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
    registration,
    provider,
    assets,
    signal,
  }: {
    deliverable: Deliverable;
    registration: SyncRegistration;
    provider: string;
    assets: Map<string, AssetImport>;
    signal: AbortSignal;
  }): Promise<DeliveryResult> {
    const change = { clientName: provider, message: `Synced record from ${provider}` };
    const imported = new Map<string, { readableId: string; name: string }>();
    // Finish every asset before the first record. Replays reuse these immutable local assets.
    for (const asset of deliverable.assets) {
      signal.throwIfAborted();
      const result = await input.importAsset({
        asset: assets.get(assetKey(asset))!,
        read: () => deliverable.openAsset(asset),
        signal,
        change,
      });
      if (result.state === 'conflict') {
        return { status: 'rejected', code: 'asset_conflict' };
      }
      imported.set(assetKey(asset), { readableId: result.readableId, name: asset.name });
    }
    let records: ReturnType<typeof deliveredRecords>;
    try {
      records = deliveredRecords({ deliverable, registration, provider, assets: imported });
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
      let assets: Map<string, AssetImport>;
      try {
        assets = deliveredAssets(deliverable);
      } catch (error) {
        return {
          status: 'rejected',
          code: error instanceof InvalidDeliveryError ? error.code : 'invalid_asset_reference',
        };
      }
      try {
        return await publish({ deliverable, registration, provider, assets, signal });
      } catch (error) {
        if (error instanceof InvalidRecordAssetError) {
          return { status: 'rejected', code: 'invalid_asset_reference' };
        }
        throw error;
      }
    },
  };
}
