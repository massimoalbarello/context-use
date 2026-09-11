import { expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { createSqliteDatabase } from '#db/client.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { RecordCatalog } from '#repositories/records/catalog.ts';
import type { AcceptRecordsInput } from '#repositories/records/contract.ts';
import { RecordFiles } from '#repositories/records/files.ts';
import { withRecordTestDatabase } from './database.ts';
import {
  activeRecord,
  insertOwner,
  insertSync,
  OWNER_ID,
  RECEIVED_AT,
  SYNC_ID,
} from './fixtures.ts';

test('catalog readers on a shared client wait for rollback; other connections cannot see unpublished records', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await insertOwner({ database, ownerId: OWNER_ID });
      await insertSync({ database });
      const input: AcceptRecordsInput = {
        ownerId: OWNER_ID,
        syncId: SYNC_ID,
        receivedAt: RECEIVED_AT.toISOString(),
        records: [{ record: activeRecord({ eventId: 'rollback' }), readableId: 'record-1' }],
      };
      const store = new RecordFiles(createLocalStorage({ dataFolder }));
      const file = await store.stage({
        input,
        accepted: input.records[0]!,
        attemptedKeys: new Set(),
      });
      const staged = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const begin = database.begin;
      // Control scheduling at the transaction boundary. All writes, reads and rollback still
      // execute in real SQLite; no SQL result or repository operation is mocked.
      const controlledDatabase = new Proxy(database, {
        // biome-ignore lint/complexity/useMaxParams: native Proxy trap signature
        get(target, property) {
          if (property !== 'begin') {
            return Reflect.get(target, property);
          }
          return (...args: Parameters<SQL['begin']>) => {
            const [options, callback] = args;
            return begin.call(database, options, async (tx) => {
              await callback(tx);
              staged.resolve();
              await resume.promise;
              throw new Error('publication rolled back');
            });
          };
        },
      });
      const writer = new RecordCatalog(controlledDatabase);
      const reader = new RecordCatalog(controlledDatabase);
      const externalDatabase = await createSqliteDatabase({ dataFolder });
      const publication = writer.publish({ input, files: [file] }).then(
        () => null,
        (error: unknown) => error,
      );
      try {
        await staged.promise;
        let readSettled = false;
        const read = reader.list({ ownerId: OWNER_ID, limit: 1, offset: 0 }).then((rows) => {
          readSettled = true;
          return rows;
        });
        const externalReader = new RecordCatalog(externalDatabase);
        expect(await externalReader.list({ ownerId: OWNER_ID, limit: 1, offset: 0 })).toEqual([]);
        expect(readSettled).toBe(false);
        resume.resolve();
        expect(await publication).toMatchObject({ message: 'publication rolled back' });
        expect(await read).toEqual([]);
        expect(await reader.find({ ownerId: OWNER_ID, readableId: 'record-1' })).toBeNull();
      } finally {
        resume.resolve();
        await publication;
        await externalDatabase.close();
      }
    },
  });
});
