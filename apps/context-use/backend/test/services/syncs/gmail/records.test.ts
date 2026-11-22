import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { AssetsRepository } from '#backend/repositories/assets/repository.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { AssetsService } from '#backend/services/assets/service.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { gmailThreads } from '#backend/services/syncs/sources/gmail/definition.ts';
import { withRecordTestDatabase } from '../../../repositories/records/database.ts';
import { unusedAssetFacesService } from '../../../support/app.ts';
import { account, attachedMessage, gmailFixture, message, sentAt } from './fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
beforeEach(() => setSystemTime(new Date('2026-11-30T12:00:00Z')));
afterEach(() => setSystemTime());

test('Gmail updates one conversation per sync and keeps earlier imports when a sync is recreated', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${sentAt}, ${sentAt})`;
      const storage = createLocalStorage(input);
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage,
      });
      const assets = new AssetsService({
        assets: new AssetsRepository(input.database),
        storage,
        faces: unusedAssetFacesService,
      });
      const destination = localRecordDestination({
        ownerId: OWNER_USER_ID,
        definitions: [gmailThreads],
        importAsset: (value) => assets.import(value),
        upsertRecord: (value) => records.upsert(value),
      });
      const source = gmailFixture();
      source.thread = { ...source.thread, messages: [attachedMessage()] };
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [gmailThreads],
        connector: { bind: () => Promise.resolve(source.provider) },
        destinationTypes: { local: destination },
      };
      const runtime = createSyncRuntime(options);
      const create = () =>
        runtime.api.createSync({
          ...scope,
          definition: gmailThreads.definition.id,
          config: {},
          connection: { id: 'mailbox', service: 'gmail' },
          destination: { type: 'local', input: {} },
        });
      let sync = await create();
      const finish = async () => {
        const maxTicks = 30;
        for (let tick = 0; tick < maxTicks; tick++) {
          await runtime.tick();
          if (
            runtime.api.sync({ ...scope, id: sync.id }).status === 'succeeded' &&
            !runtime.api.status(scope).queue.pendingRecords
          ) {
            return;
          }
        }
        throw new Error('Gmail publication did not finish');
      };
      const list = () => records.listResources({ ownerId: OWNER_USER_ID, limit: 20, offset: 0 });
      const history = () =>
        new HistoryRepository(input.database).list({
          ownerId: OWNER_USER_ID,
          limit: 20,
          resourceType: 'record',
        });
      try {
        await finish();
        const saved = (await list()).items[0]!;
        const read = () =>
          records.findResource({ ownerId: OWNER_USER_ID, readableId: saved.readableId });
        expect(await read()).toMatchObject({
          source: {
            provider: 'gmail',
            kind: 'thread',
            id: JSON.stringify([account, 'thread-one']),
          },
          title: 'Quarterly invoice',
          sourceCreatedAt: sentAt,
          sourceOccurredAt: sentAt,
          sourceUpdatedAt: sentAt,
        });
        expect((await read())!.body).toContain(
          `[Open conversation in Gmail](https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/thread-one)`,
        );
        expect((await read())!.body).toContain('### Invoice');
        expect((await read())!.body).toMatch(/\| Services\s*\| £120\.50/);
        expect((await read())!.body).toStartWith('> ### Alex\n>\n> 1 Nov 2026');
        expect((await read())!.body).not.toMatch(/## Message|^To:|^Cc:|^Sent:/m);
        const [metadata, body] = (await read())!.body.split('\n\n### Invoice');
        expect(metadata).toContain('> **Attachments** · [Revenue]');
        expect(metadata).toContain('[invoice.pdf]');
        expect(body).toContain('£120.50');
        expect(body).not.toContain('context-use://asset/');
        expect((await read())!.body).not.toContain('open-sync-asset:');
        const imported = await assets.list({ ownerId: OWNER_USER_ID, limit: 20, offset: 0 });
        expect(imported.items).toHaveLength(2);
        for (const asset of imported.items) {
          expect((await read())!.body).toContain(`context-use://asset/${asset.readableId}`);
          expect(
            (await assets.detail({ ownerId: OWNER_USER_ID, readableId: asset.readableId }))!.usages,
          ).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'record' })]));
        }
        const initialChanges = await history();
        await runtime.api.resync({ ...scope, id: sync.id });
        await finish();
        expect(await history()).toEqual(initialChanges);
        source.thread = {
          ...source.thread,
          messages: [attachedMessage(), message({ id: 'reply', text: 'Invoice received.' })],
        };
        await runtime.api.resync({ ...scope, id: sync.id });
        await finish();
        expect((await read())!.body).toContain('Invoice received.');
        expect((await list()).items).toHaveLength(1);
        expect(
          (await assets.list({ ownerId: OWNER_USER_ID, limit: 20, offset: 0 })).items,
        ).toHaveLength(2);
        source.thread = {
          ...source.thread,
          historyId: '9007199254740993020',
          messages: [
            attachedMessage(),
            message({
              id: 'reply',
              text: 'Paid in full.',
              labels: [],
              date: '2026-11-02T10:00:00Z',
            }),
          ],
        };
        source.historyPages = [
          {
            history: [{ messagesAdded: [{ message: { threadId: 'thread-one' } }] }],
            historyId: '9007199254740993020',
          },
        ];
        runtime.api.runNow({ ...scope, id: sync.id });
        await finish();
        expect((await read())!.body).toContain('***\n\n> ### Alex\n>\n> 2 Nov 2026');
        expect((await read())!.body).toContain('Paid in full.');
        expect((await read())!.sourceUpdatedAt).toBe('2026-11-02T10:00:00.000Z');
        const afterReply = await read();
        source.thread = {
          ...source.thread,
          messages: [message({ id: 'message-one', text: 'No label', labels: [] })],
        };
        runtime.api.runNow({ ...scope, id: sync.id });
        await finish();
        expect(await read()).toEqual(afterReply);
        source.thread = {
          ...source.thread,
          historyId: '9007199254740993030',
          messages: [message({ id: 'message-one', text: 'Amount due: £120.50' })],
        };
        source.historyPages = [
          {
            history: [{ messagesDeleted: [{ message: { threadId: 'thread-one' } }] }],
            historyId: '9007199254740993030',
          },
        ];
        runtime.api.runNow({ ...scope, id: sync.id });
        await finish();
        expect((await read())!.sourceUpdatedAt).toBe(sentAt);
        expect((await read())!.body).not.toContain('Paid in full.');
        for (const asset of imported.items) {
          expect(
            (await assets.detail({ ownerId: OWNER_USER_ID, readableId: asset.readableId }))!.usages,
          ).toHaveLength(0);
        }
        const original = await read();
        source.thread = { ...source.thread, messages: [attachedMessage()] };
        await runtime.api.removeSync({ ...scope, id: sync.id });
        sync = await create();
        await finish();
        const copies = (await list()).items;
        expect(copies).toHaveLength(2);
        expect(copies.map((copy) => copy.source.id)).toEqual([saved.source.id, saved.source.id]);
        const recreated = copies.find((copy) => copy.readableId !== saved.readableId)!;
        const newRecord = await records.findResource({
          ownerId: OWNER_USER_ID,
          readableId: recreated.readableId,
        });
        expect(newRecord!.body).toContain('[invoice.pdf]');
        expect(await read()).toEqual(original);
        const allAssets = await assets.list({ ownerId: OWNER_USER_ID, limit: 20, offset: 0 });
        expect(allAssets.items).toHaveLength(imported.items.length * copies.length);
        for (const asset of imported.items) {
          expect(newRecord!.body).not.toContain(`context-use://asset/${asset.readableId}`);
        }
      } finally {
        await runtime.close();
      }
    },
  });
});
