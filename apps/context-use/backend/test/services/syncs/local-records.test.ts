import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Delivery } from '@context-use/open-sync/delivery';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_SYNTHETIC_EMAIL, OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { ApiKeysRepository } from '#backend/repositories/api-keys/repository.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { localRecordDestination } from '#backend/services/syncs/destination.ts';
import { githubPullRequests } from '#backend/services/syncs/providers/github/pull-requests.ts';
import { githubRecord } from '#backend/services/syncs/providers/github/record.ts';
import { syncProviders } from '#backend/services/syncs/providers/index.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { now, page, pull } from './github-fixture.ts';
import { fixtureProvider } from './provider-fixture.ts';

const SHA256_HEX_LENGTH = 64;
const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };

test('installed npm engine stores searchable local records through existing services and resumes without duplicates', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${now}, ${now})`;
      const records = new RecordsService({
        records: new RecordsRepository(database),
        storage: createLocalStorage({ dataFolder }),
      });
      const destination = localRecordDestination({
        upsertRecord: (input) => records.upsert(input),
        ownerId: OWNER_USER_ID,
        definitions: new SyncCatalog(syncProviders).definitions,
      });
      let upstreamPull = pull();
      const provider = {
        action: () => Promise.reject(new Error('Unexpected action')),
        get: () => Promise.reject(new Error('Unexpected GET')),
        post: () =>
          Promise.resolve({ status: 200, headers: {}, body: page({ nodes: [upstreamPull] }) }),
      };
      const options = {
        databasePath: join(dataFolder, 'sync.db'),
        definitions: [githubPullRequests.registration],
        destinationTypes: { local: destination },
        connector: { bind: () => Promise.resolve(provider) },
      };
      const runtime = createSyncRuntime(options);
      let installationId: string;
      try {
        const dest = runtime.api.createDestination({ ...scope, type: 'local', config: {} });
        const installation = await runtime.api.createInstallation({
          ...scope,
          definition: githubPullRequests.registration.definition,
          connection: { id: 'github-owner', service: 'github' },
          destinationId: dest.id,
          config: {},
        });
        installationId = installation.id;
        await runtime.tick();
        await runtime.tick();
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(0);
        const listing = await records.listResources({
          ownerId: OWNER_USER_ID,
          limit: 10,
          offset: 0,
        });
        expect(listing.items).toHaveLength(1);
        expect(listing.items[0]?.title).toBe('example/project #1: Improve local records');
        expect(listing.items[0]?.source.provider).toBe('github');
        const resource = await records.findResource({
          ownerId: OWNER_USER_ID,
          readableId: listing.items[0]!.readableId,
        });
        expect(resource?.body).toContain('Keep **useful context**.');
        expect(await new ApiKeysRepository(database).list({ ownerId: OWNER_USER_ID })).toEqual([]);
        const canonical = githubRecord(pull({ id: 'PR_replay' }));
        const delivery: Delivery = {
          version: 1,
          id: crypto.randomUUID(),
          ownerId: OWNER_USER_ID,
          sourceId: installation.sourceId,
          installationId,
          definition: githubPullRequests.registration.definition,
          deliverable: {
            records: [
              {
                operation: 'upsert',
                kind: 'pull-request',
                id: 'PR_replay',
                data: canonical,
                eventId: crypto.randomUUID(),
                revision: 1,
                contentHash: 'a'.repeat(SHA256_HEX_LENGTH),
              },
            ],
          },
        };
        const input = { scope, config: {}, delivery, signal: new AbortController().signal };
        for (const invalid of [
          { ...delivery, definition: { ...delivery.definition, version: 'unknown' } },
          {
            ...delivery,
            deliverable: {
              records: [{ ...delivery.deliverable.records[0]!, kind: 'unregistered' }],
            },
          },
          {
            ...delivery,
            deliverable: {
              records: [
                {
                  ...delivery.deliverable.records[0]!,
                  data: {
                    ...canonical,
                    attributes: { unsupported: true },
                  },
                },
              ],
            },
          },
        ]) {
          expect((await destination.deliver({ ...input, delivery: invalid })).status).toBe(
            'rejected',
          );
        }
        expect(await destination.deliver(input)).toEqual({ status: 'accepted' });
        expect(await destination.deliver(input)).toEqual({ status: 'accepted' });
        expect(
          await destination.deliver({
            ...input,
            delivery: {
              ...delivery,
              sourceId: 'another-source',
              installationId: 'another-installation',
            },
          }),
        ).toEqual({ status: 'accepted' });
        expect(
          await records.upsert({
            change: { actor: { kind: 'owner' }, message: 'Updated test context' },
            ownerId: OWNER_USER_ID,
            record: canonical,
          }),
        ).toMatchObject({
          state: 'unchanged',
        });
        const withData = (record: typeof canonical): Delivery => ({
          ...delivery,
          deliverable: {
            records: [{ ...delivery.deliverable.records[0]!, operation: 'upsert', data: record }],
          },
        });
        for (const source of [
          { ...canonical.source, id: 'mismatched-id' },
          { ...canonical.source, provider: 'another-provider' },
          { ...canonical.source, kind: 'another-kind' },
        ]) {
          expect(
            await destination.deliver({ ...input, delivery: withData({ ...canonical, source }) }),
          ).toEqual({ status: 'rejected', code: 'invalid_record' });
        }
        expect(
          await destination.deliver({
            ...input,
            delivery: withData({ ...canonical, body: 'Conflicting content' }),
          }),
        ).toEqual({ status: 'rejected', code: 'conflict' });
        expect(
          await destination.deliver({
            ...input,
            delivery: withData({ ...canonical, sourceUpdatedAt: '2020-01-01T00:00:00.000Z' }),
          }),
        ).toEqual({ status: 'accepted' });

        expect(
          await destination.deliver({ ...input, scope: { actorId: 'other', ownerId: 'other' } }),
        ).toEqual({ status: 'rejected', code: 'invalid_source' });
        expect(
          (await records.listResources({ ownerId: 'other', limit: 10, offset: 0 })).items,
        ).toEqual([]);
      } finally {
        await runtime.close();
      }
      const restarted = createSyncRuntime(options);
      try {
        restarted.api.queueRun({ ...scope, id: installationId! });
        await restarted.tick();
        await restarted.tick();
        const listing = await records.listResources({
          ownerId: OWNER_USER_ID,
          limit: 10,
          offset: 0,
        });
        expect(listing.items).toHaveLength(2);
        upstreamPull = pull({ title: 'Updated pull request', updatedAt: new Date().toISOString() });
        restarted.api.queueRun({ ...scope, id: installationId! });
        await restarted.tick();
        await restarted.tick();
        const updated = await records.listResources({
          ownerId: OWNER_USER_ID,
          limit: 10,
          offset: 0,
        });
        expect(updated.items).toHaveLength(2);
        expect(
          updated.items.some(
            (record) => record.title === 'example/project #1: Updated pull request',
          ),
        ).toBe(true);
      } finally {
        await restarted.close();
      }
    },
  });
});

test('a new provider stores the common record shape through the same local destination', async () => {
  await withRecordTestDatabase({
    run: async ({ database, dataFolder }) => {
      await database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', ${OWNER_SYNTHETIC_EMAIL}, 1, ${now}, ${now})`;
      const records = new RecordsService({
        records: new RecordsRepository(database),
        storage: createLocalStorage({ dataFolder }),
      });
      const catalog = new SyncCatalog([fixtureProvider('calendar')]);
      const destination = localRecordDestination({
        upsertRecord: (input) => records.upsert(input),
        ownerId: OWNER_USER_ID,
        definitions: catalog.definitions,
      });
      const runtime = createSyncRuntime({
        databasePath: join(dataFolder, 'sync.db'),
        definitions: catalog.definitions,
        destinationTypes: { local: destination },
        connector: {
          bind: async () => ({
            get: () => {
              throw new Error('Unused');
            },
            post: () => {
              throw new Error('Unused');
            },
            action: () => {
              throw new Error('Unused');
            },
          }),
        },
      });
      try {
        const target = runtime.api.createDestination({ ...scope, type: 'local', config: {} });
        await runtime.api.createInstallation({
          ...scope,
          definition: catalog.definitions[0]!.definition,
          connection: { id: 'calendar-owner', service: 'calendar' },
          destinationId: target.id,
          config: {},
        });
        await runtime.tick();
        await runtime.tick();
        const listing = await records.listResources({
          ownerId: OWNER_USER_ID,
          limit: 10,
          offset: 0,
        });
        expect(listing.items).toHaveLength(1);
        expect(listing.items[0]).toMatchObject({
          title: 'calendar event',
          source: { provider: 'calendar', kind: 'event', id: 'event-one' },
        });
        const record = await records.findResource({
          ownerId: OWNER_USER_ID,
          readableId: listing.items[0]!.readableId,
        });
        expect(record?.body).toContain('Meeting notes.');
        expect(runtime.api.status(scope).queue.pendingRecords).toBe(0);
      } finally {
        await runtime.close();
      }
    },
  });
});
