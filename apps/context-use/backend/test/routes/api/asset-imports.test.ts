import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { RecordSyncsRepository } from '#backend/repositories/syncs/repository.ts';
import { createAssetImportsController } from '#backend/routes/api/assets/imports/controller.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { RecordSyncsService } from '#backend/services/syncs/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { unusedAssetFacesService } from '../../support/app.ts';

function digest(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

async function fixture({ database, dataFolder }: { database: SQL; dataFolder: string }) {
  const now = new Date().toISOString();
  await database`
    insert into auth_user (id, name, email, emailVerified, createdAt, updatedAt)
    values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${now}, ${now})
  `;
  const syncs = new RecordSyncsService({ syncs: new RecordSyncsRepository(database) });
  const created = await syncs.create({ actorId: OWNER_USER_ID, name: 'Mail' });
  if (created.state !== 'created') {
    throw new Error('Expected a sync');
  }
  const storage = createLocalStorage({ dataFolder });
  const assets = new AssetsRepository(database);
  const processing = { wakeups: 0 };
  const faces = {
    ...unusedAssetFacesService,
    notifyAssetSaved: () => {
      processing.wakeups += 1;
    },
  };
  const service = new AssetsService({ assets, storage, faces });
  const app = () =>
    new Elysia()
      .use(
        createAssetImportsController({
          syncsService: syncs,
          assetsService: service,
        }),
      )
      .get('/health', () => 'ok');
  return { app, storage, assets, service, processing, faces, syncs, created };
}

function upload({
  apiKey,
  key = 'attachment',
  bytes = 'hello',
  sha256 = digest(bytes),
}: {
  apiKey: string;
  key?: string;
  bytes?: string;
  sha256?: string;
}): Request {
  const body = new FormData();
  body.set('name', 'message.txt');
  body.set('sha256', sha256);
  body.set('file', new File([bytes], 'message.txt'));
  return new Request(`http://localhost/api/assets/imports/${key}`, {
    method: 'PUT',
    body,
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

test('uploads independently and recovers the same asset across retries and service restarts', async () => {
  await withRecordTestDatabase({
    run: async (context) => {
      const { app, storage, created, processing } = await fixture(context);
      const receiver = app();
      const attempts = await Promise.all([
        receiver.handle(upload({ apiKey: created.apiKey })),
        receiver.handle(upload({ apiKey: created.apiKey })),
      ]);
      expect(attempts.map((response) => response.status)).toEqual([StatusMap.OK, StatusMap.OK]);
      const asset = (await attempts[0]!.json()) as { assetId: string; url: string };
      expect(await attempts[1]!.json()).toEqual(asset);
      expect(asset).toMatchObject({ sha256: digest('hello'), sizeBytes: 5 });
      expect(asset.url).toBe(`context-use://asset/${asset.assetId}`);
      const recovered = await app().handle(
        new Request('http://localhost/api/assets/imports/attachment', {
          headers: { authorization: `Bearer ${created.apiKey}` },
        }),
      );
      expect(recovered.status).toBe(StatusMap.OK);
      expect(await recovered.json()).toEqual(asset);
      expect(processing.wakeups).toBe(1);
      const rows = await context.database<Array<{ storageKey: string }>>`
      select storage_key as storageKey from asset
    `;
      expect(rows).toHaveLength(1);
      expect(await storage.file(rows[0]!.storageKey).text()).toBe('hello');
      expect(
        (await receiver.handle(upload({ apiKey: created.apiKey, bytes: 'changed' }))).status,
      ).toBe(StatusMap.Conflict);
      expect(
        (await receiver.handle(upload({ apiKey: created.apiKey, key: 'empty', bytes: '' }))).status,
      ).toBe(StatusMap.OK);
      expect((await receiver.handle(new Request('http://localhost/health'))).status).toBe(
        StatusMap.OK,
      );
    },
  });
});

test('rejects invalid bytes, isolates upload keys by sync, and respects revocation and archiving', async () => {
  await withRecordTestDatabase({
    run: async (context) => {
      const { app, syncs, created } = await fixture(context);
      const receiver = app();
      expect(
        (await receiver.handle(upload({ apiKey: created.apiKey, sha256: digest('wrong') }))).status,
      ).toBe(StatusMap['Bad Request']);
      expect(await context.database`select id from asset`).toHaveLength(0);
      expect((await receiver.handle(upload({ apiKey: Bun.randomUUIDv7() }))).status).toBe(
        StatusMap.Unauthorized,
      );
      expect((await receiver.handle(upload({ apiKey: created.apiKey }))).status).toBe(StatusMap.OK);
      const other = await syncs.create({ actorId: OWNER_USER_ID, name: 'Other' });
      if (other.state !== 'created') {
        throw new Error('Expected a sync');
      }
      const missing = await receiver.handle(
        new Request('http://localhost/api/assets/imports/attachment', {
          headers: { authorization: `Bearer ${other.apiKey}` },
        }),
      );
      expect(missing.status).toBe(StatusMap['Not Found']);
      await context.database`update asset set archived_at = ${new Date().toISOString()}`;
      expect((await receiver.handle(upload({ apiKey: created.apiKey }))).status).toBe(
        StatusMap.Conflict,
      );
      await syncs.revoke({ actorId: OWNER_USER_ID, readableId: created.sync.readableId });
      expect((await receiver.handle(upload({ apiKey: created.apiKey, key: 'next' }))).status).toBe(
        StatusMap.Unauthorized,
      );
      expect(await context.database`select id from asset`).toHaveLength(1);
    },
  });
});

test('publishes nothing after an incomplete write or a revocation during upload', async () => {
  await withRecordTestDatabase({
    run: async (context) => {
      const { storage, assets, faces, created, syncs } = await fixture(context);
      const principal = await syncs.authenticate({ apiKey: created.apiKey });
      if (!principal) {
        throw new Error('Expected authentication');
      }
      const input = {
        ownerId: principal.ownerId,
        sync: { syncId: principal.syncId, key: 'attachment', sha256: digest('hello') },
        name: 'message.txt',
        file: new Blob(['hello']),
      };
      const incomplete: Storage = {
        file: (key) => storage.file(key),
        exists: (key) => storage.exists(key),
        size: (key) => storage.size(key),
        delete: (key) => storage.delete(key),
        write: async (...args) => (await storage.write(...args)) - 1,
      };
      await expect(
        new AssetsService({ assets, faces, storage: incomplete }).create(input),
      ).rejects.toThrow('not fully written');
      expect(await assets.findImport({ ...principal, key: input.sync.key })).toBeNull();
      await expect(
        new AssetsService({ assets, faces, storage: incomplete }).create({
          ownerId: principal.ownerId,
          name: 'Manual upload',
          file: input.file,
        }),
      ).rejects.toThrow('not fully written');
      expect(
        await Array.fromAsync(
          new Bun.Glob('**/*').scan({ cwd: `${context.dataFolder}/objects`, onlyFiles: true }),
        ),
      ).toEqual([]);
      const revoking: Storage = {
        ...incomplete,
        write: async (...args) => {
          const count = await storage.write(...args);
          await syncs.revoke({ actorId: OWNER_USER_ID, readableId: created.sync.readableId });
          return count;
        },
      };
      expect(await new AssetsService({ assets, faces, storage: revoking }).create(input)).toEqual({
        state: 'inactive_sync',
      });
      expect(await context.database`select id from asset`).toHaveLength(0);
      expect(await assets.findImport({ ...principal, key: input.sync.key })).toBeNull();
    },
  });
});

test('sync deletion removes import mappings while preserving asset bytes and creation origin', async () => {
  await withRecordTestDatabase({
    run: async (context) => {
      const { app, service, faces, storage, processing, syncs, created } = await fixture(context);
      const principal = await syncs.authenticate({ apiKey: created.apiKey });
      if (!principal) {
        throw new Error('Expected authentication');
      }
      const response = await app().handle(upload({ apiKey: created.apiKey }));
      const imported = (await response.json()) as { assetId: string };
      expect(response.status).toBe(StatusMap.OK);
      expect(
        await service.detail({ ownerId: principal.ownerId, readableId: imported.assetId }),
      ).toMatchObject({
        origin: 'sync',
        sync: { readableId: created.sync.readableId, name: 'Mail' },
      });
      expect(
        await service.detail({ ownerId: 'another-owner', readableId: imported.assetId }),
      ).toBeNull();
      const renamed = await service.updateName({
        ownerId: principal.ownerId,
        readableId: imported.assetId,
        name: 'Renamed attachment',
      });
      expect(renamed).toMatchObject({
        name: 'Renamed attachment',
        origin: 'sync',
        sync: { readableId: created.sync.readableId, name: 'Mail' },
      });
      // A fresh service recovers the original asset and preserves the user's renamed label.
      const restarted = new AssetsService({
        assets: new AssetsRepository(context.database),
        faces,
        storage,
      });
      const retried = await restarted.create({
        ownerId: principal.ownerId,
        name: 'message.txt',
        file: new Blob(['hello']),
        sync: { syncId: principal.syncId, key: 'attachment', sha256: digest('hello') },
      });
      expect(retried).toMatchObject({
        state: 'created',
        asset: {
          readableId: imported.assetId,
          name: 'Renamed attachment',
          origin: 'sync',
          sync: { readableId: created.sync.readableId, name: 'Mail' },
        },
      });
      expect(processing.wakeups).toBe(1);
      const manual = await service.create({
        ownerId: principal.ownerId,
        name: 'Manual upload',
        file: new Blob(['manual']),
      });
      expect(manual).toMatchObject({ state: 'created', asset: { origin: 'upload', sync: null } });
      expect(processing.wakeups).toBe(2);
      await syncs.revoke({ actorId: principal.ownerId, readableId: created.sync.readableId });
      expect(
        await service.detail({ ownerId: principal.ownerId, readableId: imported.assetId }),
      ).toMatchObject({
        origin: 'sync',
        sync: { readableId: created.sync.readableId, name: 'Mail' },
      });
      await context.database`delete from record_sync where id = ${principal.syncId} and owner_id = ${principal.ownerId}`;
      expect(await context.database`select * from asset_import`).toHaveLength(0);
      expect(await context.database`select id from asset`).toHaveLength(2);
      expect(
        await service.detail({ ownerId: principal.ownerId, readableId: imported.assetId }),
      ).toMatchObject({ origin: 'sync', sync: null });
      expect(
        await service.updateName({
          ownerId: principal.ownerId,
          readableId: imported.assetId,
          name: 'Retained attachment',
        }),
      ).toMatchObject({ origin: 'sync', sync: null });
      const content = await service.content({
        ownerId: principal.ownerId,
        readableId: imported.assetId,
      });
      expect(content?.asset.origin).toBe('sync');
      expect(await content?.blob.text()).toBe('hello');
      expect(await restarted.findImport({ ...principal, key: 'attachment' })).toBeNull();
      expect(
        await service.archive({ ownerId: principal.ownerId, readableId: imported.assetId }),
      ).toEqual({ state: 'archived' });
      expect(
        (
          await context.database`select origin from asset where readable_id = ${imported.assetId}`
        )[0],
      ).toEqual({ origin: 'sync' });
    },
  });
});

test('user uploads and sync retries share publication rollback and concurrent persistence', async () => {
  await withRecordTestDatabase({
    run: async (context) => {
      const { service, processing, syncs, created } = await fixture(context);
      const principal = await syncs.authenticate({ apiKey: created.apiKey });
      if (!principal) {
        throw new Error('Expected authentication');
      }
      const manual = { ownerId: principal.ownerId, name: 'Same name', file: new Blob(['hello']) };
      const synced = {
        ...manual,
        sync: { syncId: principal.syncId, key: 'attachment', sha256: digest('hello') },
      };
      await context.database`create trigger reject_asset before insert on asset begin select raise(abort, 'Publication failed'); end`;
      for (const input of [manual, synced]) {
        await expect(service.create(input)).rejects.toThrow('Publication failed');
      }
      expect(await context.database`select id from asset`).toHaveLength(0);
      expect(await context.database`select * from asset_import`).toHaveLength(0);
      expect(processing.wakeups).toBe(0);
      expect(
        await Array.fromAsync(
          new Bun.Glob('**/*').scan({ cwd: `${context.dataFolder}/objects`, onlyFiles: true }),
        ),
      ).toEqual([]);
      await context.database`drop trigger reject_asset`;
      // Failing the mapping insert must roll back the asset and search publication as well.
      await context.database`create trigger reject_import before insert on asset_import begin select raise(abort, 'Mapping failed'); end`;
      await expect(service.create(synced)).rejects.toThrow('Mapping failed');
      expect(await context.database`select id from asset`).toHaveLength(0);
      expect(
        await context.database`select * from hypermedia_search_document where resource_type = 'asset'`,
      ).toHaveLength(0);
      await context.database`drop trigger reject_import`;
      const [uploadResult, first, retry] = await Promise.all([
        service.create(manual),
        service.create(synced),
        service.create(synced),
      ]);
      expect(uploadResult).toMatchObject({ state: 'created', asset: { origin: 'upload' } });
      expect(first).toMatchObject({ state: 'created', asset: { origin: 'sync' } });
      expect(retry).toEqual(first);
      expect(await context.database`select id from asset`).toHaveLength(2);
      expect(await context.database`select * from asset_import`).toHaveLength(1);
      expect(processing.wakeups).toBe(2);
      expect(
        await Array.fromAsync(
          new Bun.Glob('**/*').scan({ cwd: `${context.dataFolder}/objects`, onlyFiles: true }),
        ),
      ).toHaveLength(2);
    },
  });
});
