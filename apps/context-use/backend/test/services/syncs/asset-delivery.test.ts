import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DestinationType } from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { recordAssetUsages } from '#backend/models/records/assets.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { importedAssetReadableId } from '#backend/services/syncs/destinations/local/record-assets.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import {
  assetBundle,
  assetChange,
  assetDefinition,
  assetDelivery,
  assetHost,
  assetScope,
  fixtureFiles,
  insertAssetOwners,
} from './asset-fixture.ts';

const RECORD_USAGE_COUNT = 3;
const ASSET_AND_RECORD_HISTORY_COUNT = 3;
const TWO_SYNC_ASSET_COUNT = 4;
const AFTER_VERSION_UPDATE_ASSET_COUNT = 5;

function unexpected(): never {
  throw new Error('Unexpected provider call');
}

test('npm delivery persists assets before records and reuses them after partial upload, lost acknowledgement and restart', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      let failNotes = true;
      let loseAcknowledgement = true;
      const storage = createLocalStorage(input);
      let host = assetHost({
        ...input,
        storage: {
          ...storage,
          file: storage.file.bind(storage),
          exists: storage.exists.bind(storage),
          size: storage.size.bind(storage),
          delete: storage.delete.bind(storage),
          // biome-ignore lint/complexity/useMaxParams: Implements the storage boundary.
          write: async (key, blob) => {
            if (failNotes && (await blob.text()) === fixtureFiles[1]!.text) {
              throw new Error('Disk unavailable');
            }
            return storage.write(key, blob);
          },
        },
      });
      const seen: string[] = [];
      const destination: DestinationType = {
        ...host.destination,
        deliver: async (value) => {
          seen.push(value.deliverable.id);
          const original = JSON.stringify(value.deliverable.records);
          const result = await host.destination.deliver(value);
          expect(JSON.stringify(value.deliverable.records)).toBe(original);
          if (loseAcknowledgement) {
            throw new Error('Acknowledgement lost');
          }
          return result;
        },
      };
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [assetDefinition],
        destinationTypes: { local: destination },
        connector: {
          bind: async () => ({ get: unexpected, post: unexpected, action: unexpected }),
        },
      };
      let runtime = createSyncRuntime(options);
      let reopened: Awaited<ReturnType<typeof createSqliteDatabase>> | undefined;
      try {
        const sync = await runtime.api.createSync({
          ...assetScope,
          definition: assetDefinition.definition.id,
          connection: { id: 'fixture', service: 'fixture' },
          config: {},
          destination: { type: 'local', input: {} },
        });
        await runtime.tick();
        await runtime.tick();
        expect((await host.listAssets()).items).toHaveLength(1);
        expect((await host.list()).items).toHaveLength(0);
        const pending = runtime.api.deliveries({ ...assetScope, syncId: sync.id }).deliveries[0]!;
        expect(pending).toBeDefined();
        failNotes = false;
        runtime.api.retryDelivery({ ...assetScope, syncId: sync.id, id: pending.id });
        await runtime.tick();
        expect((await host.listAssets()).items).toHaveLength(2);
        expect((await host.list()).items).toHaveLength(1);
        const history = (await host.history()).items;
        expect(history.map((row) => row.resourceType)).toEqual(['record', 'asset', 'asset']);
        const readableId = (await host.list()).items[0]!.readableId;
        const record = await host.records.findResource({ ownerId: assetScope.ownerId, readableId });
        const usages = recordAssetUsages(record!.body);
        expect(usages).toHaveLength(RECORD_USAGE_COUNT);
        expect(record!.body).toContain('`open-sync-asset:diagram`');
        expect(record!.body).toContain('![literal](open-sync-asset:diagram)');
        expect(record!.body).toContain('Notes \\[read\\]');
        for (const asset of (await host.listAssets()).items) {
          const content = await host.assets.content({
            ownerId: assetScope.ownerId,
            readableId: asset.readableId,
          });
          expect(fixtureFiles.map((file) => file.text)).toContain(await content!.blob.text());
          expect(content).not.toBeNull();
          expect(
            (
              await host.assets.detail({
                ownerId: assetScope.ownerId,
                readableId: asset.readableId,
              })
            )?.usages.every((usage) => usage.kind === 'record'),
          ).toBe(true);
          expect(
            (
              await host.assets.archive({
                ...assetScope,
                readableId: asset.readableId,
                change: assetChange,
              })
            ).state,
          ).toBe('resource_in_use');
        }
        await runtime.close();
        reopened = await createSqliteDatabase(input);
        host = assetHost({ ...input, database: reopened });
        loseAcknowledgement = false;
        runtime = createSyncRuntime(options);
        runtime.api.retryDelivery({ ...assetScope, syncId: sync.id, id: pending.id });
        await runtime.tick();
        expect(runtime.api.status(assetScope).queue.pendingRecords).toBe(0);
        expect(new Set(seen)).toEqual(new Set([pending.id]));
        expect((await host.history()).items).toEqual(history);
        await runtime.api.resync({ ...assetScope, id: sync.id });
        await runtime.tick();
        await runtime.tick();
        expect((await host.history()).items).toEqual(history);
        expect((await host.listAssets()).items).toHaveLength(2);
        expect(
          await host.records.findResource({ ownerId: assetScope.ownerId, readableId }),
        ).toEqual(record);
      } finally {
        await runtime.close();
        await reopened?.close();
      }
    },
  });
});

test('unavailable and unsupported descriptors reject the entire batch without storing assets or records', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      const host = assetHost(input);
      const bundle = assetBundle();
      for (const replacement of [
        { ...fixtureFiles[0]!, unavailable: 'forbidden' },
        { ...bundle.assets[0]!, size: MAX_ASSET_BYTES + 1 },
        { ...bundle.assets[0]!, size: 0 },
        { ...bundle.assets[0]!, name: 'x'.repeat(MAX_ASSET_NAME_LENGTH + 1) },
      ]) {
        expect(
          (
            await host.destination.deliver(
              assetDelivery({ ...bundle, assets: [bundle.assets[1]!, replacement] }),
            )
          ).status,
        ).toBe('rejected');
      }
      expect((await host.listAssets()).items).toEqual([]);
      expect((await host.list()).items).toEqual([]);
      expect((await host.history()).items).toEqual([]);
    },
  });
});

test('records use returned local asset IDs and link image-only and data-only attachments', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      const host = assetHost(input);
      const destination = localRecordDestination({
        ownerId: assetScope.ownerId,
        definitions: [assetDefinition],
        importAsset: async (value) => {
          expect((await host.list()).items).toEqual([]);
          return host.assets.import({
            ...value,
            asset: { ...value.asset, readableId: `local-${value.asset.readableId}` },
          });
        },
        upsertRecord: (value) => host.records.upsert(value),
      });
      const bundle = assetBundle();
      const delivered = bundle.records[0]!;
      if (delivered.operation !== 'upsert') {
        throw new Error('Expected an upsert fixture');
      }
      bundle.records[0] = {
        ...delivered,
        content: { format: 'markdown', body: '![Diagram](open-sync-asset:diagram)' },
      };
      expect(await destination.deliver(assetDelivery(bundle))).toEqual({ status: 'accepted' });
      const { readableId } = (await host.list()).items[0]!;
      const record = await host.records.findResource({ ...assetScope, readableId });
      const usages = recordAssetUsages(record!.body);
      expect(usages).toHaveLength(RECORD_USAGE_COUNT);
      for (const asset of (await host.listAssets()).items) {
        expect(asset.readableId.startsWith('local-')).toBe(true);
        expect(usages).toContainEqual({ readableId: asset.readableId, presentation: 'attachment' });
        expect(
          await host.assets.content({ ...assetScope, readableId: asset.readableId }),
        ).not.toBeNull();
      }
      expect(record!.body).not.toContain('open-sync-asset:');
    },
  });
});

test('hash mismatch, truncated storage and cancellation leave no record or incomplete asset mapping', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      const storage = createLocalStorage(input);
      const host = assetHost(input);
      await expect(
        host.destination.deliver(
          assetDelivery({
            ...assetBundle(),
            openAsset: async () => new Blob(['wrong bytes']).stream(),
          }),
        ),
      ).rejects.toThrow('integrity');
      const failed = assetHost({
        ...input,
        storage: {
          file: storage.file.bind(storage),
          exists: storage.exists.bind(storage),
          size: storage.size.bind(storage),
          delete: storage.delete.bind(storage),
          write: () => Promise.reject(new Error('Disk unavailable')),
        },
      });
      await expect(failed.destination.deliver(assetDelivery())).rejects.toThrow('Disk unavailable');
      const truncated = assetHost({
        ...input,
        storage: {
          file: storage.file.bind(storage),
          exists: storage.exists.bind(storage),
          size: storage.size.bind(storage),
          delete: storage.delete.bind(storage),
          // biome-ignore lint/complexity/useMaxParams: Implements the storage boundary.
          write: async (key, blob) => storage.write(key, blob.slice(0, 1)),
        },
      });
      await expect(truncated.destination.deliver(assetDelivery())).rejects.toThrow('fully written');
      await expect(
        host.destination.deliver(
          assetDelivery({
            ...assetBundle(),
            openAsset: async () => new Blob(['oversized bytes'.repeat(10)]).stream(),
          }),
        ),
      ).rejects.toThrow('maxBuffer');
      const abort = new AbortController();
      const started = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      const pending = host.destination.deliver({
        ...assetDelivery({
          ...assetBundle(),
          openAsset: async () =>
            new ReadableStream({
              start: () => started.resolve(),
              cancel: () => closed.resolve(),
            }),
        }),
        signal: abort.signal,
      });
      await started.promise;
      abort.abort();
      await expect(pending).rejects.toThrow();
      await closed.promise;
      expect((await host.listAssets()).items).toEqual([]);
      expect((await host.list()).items).toEqual([]);
      expect((await host.history()).items).toEqual([]);
      const files = await readdir(join(input.dataFolder, 'objects'), { recursive: true });
      expect(files.filter((file) => /content\./.test(file))).toEqual([]);
    },
  });
});

test.each([false, true])(
  'overlapping attempts use private candidate files (late cancellation: %s)',
  async (cancelled) => {
    await withRecordTestDatabase({
      run: async (input) => {
        await insertAssetOwners(input.database);
        const storage = createLocalStorage(input);
        const written = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let hold = true;
        const host = assetHost({
          ...input,
          storage: {
            file: storage.file.bind(storage),
            exists: storage.exists.bind(storage),
            size: storage.size.bind(storage),
            delete: storage.delete.bind(storage),
            // biome-ignore lint/complexity/useMaxParams: Implements the storage boundary.
            write: async (key, blob) => {
              const size = await storage.write(key, blob);
              if (hold) {
                hold = false;
                written.resolve();
                await release.promise;
              }
              return size;
            },
          },
        });
        const abort = new AbortController();
        const original = host.destination.deliver({ ...assetDelivery(), signal: abort.signal });
        await written.promise;
        if (cancelled) {
          abort.abort();
        }
        expect(await host.destination.deliver(assetDelivery())).toEqual({ status: 'accepted' });
        release.resolve();
        if (cancelled) {
          await expect(original).rejects.toThrow();
        } else {
          expect(await original).toEqual({ status: 'accepted' });
        }
        const assets = (await host.listAssets()).items;
        expect(assets).toHaveLength(2);
        for (const asset of assets) {
          expect(
            await host.assets.content({
              ownerId: assetScope.ownerId,
              readableId: asset.readableId,
            }),
          ).not.toBeNull();
        }
        expect((await host.history()).items).toHaveLength(ASSET_AND_RECORD_HISTORY_COUNT);
        const files = await readdir(join(input.dataFolder, 'objects'), { recursive: true });
        expect(files.filter((file) => /content\./.test(file))).toHaveLength(2);
      },
    });
  },
);

test('asset versions and syncs remain isolated, removed usages permit archive, and archived identities cannot be recreated', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      const host = assetHost(input);
      const original = assetBundle();
      expect(await host.destination.deliver(assetDelivery(original))).toEqual({
        status: 'accepted',
      });
      const firstAssetId = importedAssetReadableId({ ...original, asset: original.assets[0]! });
      expect(
        await host.assets.content({ ownerId: 'other-owner', readableId: firstAssetId }),
      ).toBeNull();
      expect(
        importedAssetReadableId({
          ...original,
          ownerId: 'other-owner',
          asset: original.assets[0]!,
        }),
      ).not.toBe(firstAssetId);
      const other = { ...original, syncId: 'another-sync' };
      expect(await host.destination.deliver(assetDelivery(other))).toEqual({ status: 'accepted' });
      expect((await host.listAssets()).items).toHaveLength(TWO_SYNC_ASSET_COUNT);
      expect((await host.list()).items).toHaveLength(2);
      const updated = {
        ...original,
        records: original.records.map((record) => ({
          ...record,
          revision: 2,
          assetRefs: {},
          content: { format: 'markdown' as const, body: 'Attachments removed' },
        })),
        assets: [],
      };
      expect(await host.destination.deliver(assetDelivery(updated))).toEqual({
        status: 'accepted',
      });
      expect(
        (
          await host.assets.archive({
            ...assetScope,
            readableId: firstAssetId,
            change: assetChange,
          })
        ).state,
      ).toBe('archived');
      expect(await host.destination.deliver(assetDelivery(original))).toEqual({
        status: 'rejected',
        code: 'asset_conflict',
      });
      const replacement = {
        ...original,
        assets: original.assets.map((asset) => ({ ...asset, version: '2' })),
        records: original.records.map((record) =>
          record.operation === 'upsert'
            ? {
                ...record,
                revision: 3,
                assetRefs: Object.fromEntries(
                  Object.entries(record.assetRefs!).map(([key, ref]) => [
                    key,
                    { ...ref, version: '2' },
                  ]),
                ),
              }
            : record,
        ),
        openAsset: original.openAsset.bind(null),
      };
      replacement.openAsset = (ref) => original.openAsset({ ...ref, version: '1' });
      expect(await host.destination.deliver(assetDelivery(replacement))).toEqual({
        status: 'accepted',
      });
      expect((await host.listAssets()).items).toHaveLength(AFTER_VERSION_UPDATE_ASSET_COUNT);
      expect(
        (
          await host.assets.detail({
            ...assetScope,
            readableId: importedAssetReadableId({ ...replacement, asset: replacement.assets[0]! }),
          })
        )?.usages,
      ).toHaveLength(2);
    },
  });
});

test('publication rejects an archive race atomically and replay verifies the existing blob before accepting', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await insertAssetOwners(input.database);
      const host = assetHost(input);
      const target = importedAssetReadableId({ ...assetBundle(), asset: assetBundle().assets[0]! });
      const racing = localRecordDestination({
        ownerId: assetScope.ownerId,
        definitions: [assetDefinition],
        importAsset: (value) => host.assets.import(value),
        upsertRecord: async (value) => {
          expect(
            (await host.assets.archive({ ...assetScope, readableId: target, change: assetChange }))
              .state,
          ).toBe('archived');
          return host.records.upsert(value);
        },
      });
      expect(await racing.deliver(assetDelivery())).toEqual({
        status: 'rejected',
        code: 'invalid_asset_reference',
      });
      expect((await host.list()).items).toEqual([]);
      expect(await input.database`select * from "record_asset_usage"`).toHaveLength(0);
      expect((await host.history()).items.filter((item) => item.resourceType === 'record')).toEqual(
        [],
      );
      const second = (await host.listAssets()).items[0]!;
      const content = await host.assets.content({ ...assetScope, readableId: second.readableId });
      await host.storage.delete(content!.asset.storageKey);
      const bundle = assetBundle();
      bundle.assets.reverse();
      await expect(host.destination.deliver(assetDelivery(bundle))).rejects.toThrow('missing');
    },
  });
});
