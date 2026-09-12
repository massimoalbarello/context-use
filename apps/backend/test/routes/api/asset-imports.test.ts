import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { Elysia, StatusMap } from 'elysia';
import { OWNER_USER_ID } from '#lib/auth/owner-registration.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import type { Storage } from '#lib/storage/storage.ts';
import { AssetImportsRepository } from '#repositories/assets/imports.ts';
import { RecordSyncsRepository } from '#repositories/syncs/repository.ts';
import { createAssetImportsController } from '#routes/api/assets/imports/controller.ts';
import { AssetImportsService } from '#services/assets/imports.ts';
import { RecordSyncsService } from '#services/syncs/service.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';

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
  const imports = new AssetImportsRepository(database);
  const app = () =>
    new Elysia()
      .use(
        createAssetImportsController({
          syncsService: syncs,
          assetImportsService: new AssetImportsService({ imports, storage }),
        }),
      )
      .get('/health', () => 'ok');
  return { app, storage, imports, syncs, created };
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
      const { app, storage, created } = await fixture(context);
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
      const { storage, imports, created, syncs } = await fixture(context);
      const principal = await syncs.authenticate({ apiKey: created.apiKey });
      if (!principal) {
        throw new Error('Expected authentication');
      }
      const input = {
        ...principal,
        key: 'attachment',
        name: 'message.txt',
        sha256: digest('hello'),
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
        new AssetImportsService({ imports, storage: incomplete }).upload(input),
      ).rejects.toThrow('not fully written');
      expect(await imports.find(input)).toBeNull();
      const revoking: Storage = {
        ...incomplete,
        write: async (...args) => {
          const count = await storage.write(...args);
          await syncs.revoke({ actorId: OWNER_USER_ID, readableId: created.sync.readableId });
          return count;
        },
      };
      expect(await new AssetImportsService({ imports, storage: revoking }).upload(input)).toEqual({
        state: 'inactive_sync',
      });
      expect(await context.database`select id from asset`).toHaveLength(0);
      expect(await imports.find(input)).toBeNull();
    },
  });
});
