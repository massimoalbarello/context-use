import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { HistoryRepository } from '#backend/repositories/history/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { googleCalendarEvents } from '#backend/services/syncs/sources/googlecalendar/definition.ts';
import { googleCalendarProvider } from '#backend/services/syncs/sources/googlecalendar/provider.ts';
import { syncProviders } from '#backend/services/syncs/sources/index.ts';
import { withRecordTestDatabase } from '../../../repositories/records/database.ts';
import { calendarFixture, created, event } from './googlecalendar-fixture.ts';

const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
const backfillCount = 3;
function unexpected(): never {
  throw new Error('Unexpected asset import');
}

test('Calendar catalog registers readable events with OAuth setup and native source capabilities', () => {
  const catalog = new SyncCatalog(syncProviders);
  expect(catalog.provider('googlecalendar')).toEqual(googleCalendarProvider);
  expect(catalog.sync('googlecalendar.events').sync.registration).toBe(googleCalendarEvents);
  expect(googleCalendarEvents.definition.provider.service).toBe('googlecalendar');
  expect(googleCalendarProvider.oauth.createAppUrl).toBe(
    'https://console.cloud.google.com/auth/clients',
  );
});

test('Calendar saves complete event records, updates cancellations and does not duplicate record history on replay', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${created}, ${created})`;
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage: createLocalStorage(input),
      });
      const source = calendarFixture();
      const options = {
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: [googleCalendarEvents],
        connector: { bind: () => Promise.resolve(source.provider) },
        destinationTypes: {
          local: localRecordDestination({
            ownerId: OWNER_USER_ID,
            definitions: [googleCalendarEvents],
            importAsset: unexpected,
            upsertRecord: (value) => records.upsert(value),
          }),
        },
      };
      let runtime = createSyncRuntime(options);
      try {
        const sync = await runtime.api.createSync({
          ...scope,
          definition: googleCalendarEvents.definition.id,
          connection: { id: 'calendar-owner', service: 'googlecalendar' },
          destination: { type: 'local', input: {} },
          config: {},
        });
        const resource = { ...scope, id: sync.id };
        const finish = async () => {
          const maxTicks = 30;
          for (let tick = 0; tick < maxTicks; tick++) {
            await runtime.tick();
            if (
              runtime.api.sync(resource).status === 'succeeded' &&
              runtime.api.status(scope).queue.pendingRecords === 0
            ) {
              return;
            }
          }
          throw new Error('Calendar delivery did not finish');
        };
        await runtime.tick();
        await runtime.close();
        runtime = createSyncRuntime(options);
        await finish();
        const list = () => records.listResources({ ownerId: OWNER_USER_ID, limit: 20, offset: 0 });
        const stored = await list();
        expect(stored.items).toHaveLength(backfillCount);
        const first = stored.items.find((record) => record.source.id === '["a","one"]')!;
        const other = stored.items.find((record) => record.source.id === '["b","one"]')!;
        expect(first.readableId).not.toBe(other.readableId);
        const read = (readableId: string) =>
          records.findResource({ ownerId: OWNER_USER_ID, readableId });
        const saved = await read(first.readableId);
        expect(saved).toMatchObject({
          title: 'Event one',
          source: { provider: 'googlecalendar', kind: 'event', id: '["a","one"]' },
          sourceCreatedAt: new Date(created).toISOString(),
          sourceUpdatedAt: new Date(created).toISOString(),
        });
        expect(saved!.body).toContain('Guest — guest@example.com (accepted)');
        expect(saved!.body).toContain('Location: Meeting room');
        expect(saved!.body).toContain('Description:\n\nDiscuss the plan');
        expect((await read(other.readableId))!.body).toContain('Start: 2026-10-01 (all day)');
        const history = () =>
          new HistoryRepository(input.database).list({
            ownerId: OWNER_USER_ID,
            limit: 20,
            resourceType: 'record',
          });
        const originalHistory = await history();
        runtime.api.runNow(resource);
        await finish();
        expect(await history()).toEqual(originalHistory);
        source.delta = [
          { ...event('one'), summary: 'Edited event' },
          { id: 'two', status: 'cancelled' },
        ];
        runtime.api.runNow(resource);
        await finish();
        expect((await list()).items).toHaveLength(backfillCount);
        expect((await read(first.readableId))!.title).toBe('Edited event');
        const cancelled = (await list()).items.find(
          (record) => record.source.id === '["a","two"]',
        )!;
        expect((await read(cancelled.readableId))!.body).toContain('Status: cancelled');
        const editedHistory = await history();
        runtime.api.runNow(resource);
        await finish();
        expect(await history()).toEqual(editedHistory);
      } finally {
        await runtime.close();
      }
    },
  });
});
