import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ProviderApi } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { LOCAL_RECORD_DESTINATION } from '#backend/models/syncs/managed.ts';
import { RecordsRepository } from '#backend/repositories/records/repository.ts';
import { RecordsService } from '#backend/services/records/service.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { localRecordDestination } from '#backend/services/syncs/destinations/local/definition.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { withRecordTestDatabase } from '../../repositories/records/database.ts';
import { now } from './github-fixture.ts';
import { fixtureProvider } from './provider-fixture';

function unexpected(): never {
  throw new Error('Unexpected provider call');
}

test('provider registrations share management and destination code while delivery queues and actions stay isolated', async () => {
  await withRecordTestDatabase({
    run: async (input) => {
      await input.database`insert into "auth_user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values (${OWNER_USER_ID}, 'Owner', 'owner@example.invalid', 1, ${now}, ${now})`;
      const records = new RecordsService({
        records: new RecordsRepository(input.database),
        storage: createLocalStorage(input),
      });
      const alpha = fixtureProvider('alpha');
      const beta = fixtureProvider('beta');
      const catalog = new SyncCatalog([alpha, beta]);
      const destination = localRecordDestination({
        ownerId: OWNER_USER_ID,
        definitions: catalog.definitions,
        importAsset: unexpected,
        upsertRecord: (value) => records.upsert(value),
      });
      let rejectAlpha = true;
      const runtime = createSyncRuntime({
        databasePath: join(input.dataFolder, 'sync.db'),
        definitions: catalog.definitions,
        connector: {
          bind: async () => ({ get: unexpected, post: unexpected, action: unexpected }),
        },
        destinationTypes: {
          [LOCAL_RECORD_DESTINATION]: {
            ...destination,
            deliver: async (value) =>
              rejectAlpha && value.deliverable.definition === 'alpha.events'
                ? { status: 'rejected', code: 'test_rejection' }
                : destination.deliver(value),
          },
        },
      });
      const connections = catalog.providers.map((provider) => ({
        id: `${provider.id}-connection`,
        service: provider.id,
        account: `${provider.id}-account`,
        status: 'active',
        authType: 'oauth2' as const,
      }));
      const providers: ProviderApi = {
        credentials: unexpected,
        configure: unexpected,
        start: unexpected,
        connection: unexpected,
        catalog: unexpected,
        connections: () => Promise.resolve(connections),
        status: ({ service }) =>
          Promise.resolve({
            provider: {
              service,
              displayName: service,
              iconUrl: null,
              categories: [],
              scenario: '',
              authTypes: ['oauth2'],
            },
            setup: {
              service,
              auth: [],
              oauthClient: {
                configured: true,
                customClientAvailable: false,
                expectedRedirectUri: 'https://host/api/open-sync/oauth/callback',
                missingFields: [],
              },
            },
            connections: connections.filter((connection) => connection.service === service),
          }),
      };
      const service = new ManagedSyncsService({
        catalog,
        sync: { api: runtime.api, providers },
      });
      const actor = { actorId: OWNER_USER_ID };
      const scope = { ...actor, ownerId: OWNER_USER_ID };
      try {
        await expect(service.connect({ actorId: 'other', providerId: 'alpha' })).rejects.toThrow(
          'Forbidden',
        );
        await expect(service.connect({ ...actor, providerId: 'missing' })).rejects.toThrow(
          'not found',
        );
        await service.connect({ ...actor, providerId: 'alpha' });
        await service.connect({ ...actor, providerId: 'beta' });
        await service.completeConnection({ ...actor, providerId: 'alpha' });
        expect(runtime.api.syncs(scope)).toHaveLength(2);
        // Allow each provider to acquire records and drain its delivery queue.
        for (const _provider of catalog.providers) {
          await runtime.tick();
          await runtime.tick();
        }
        const listed = await service.list(actor);
        expect(listed[0]?.syncs[0]?.state).toBe('error');
        expect(listed[1]?.syncs[0]?.state).toBe('ready');
        expect(listed[1]?.account.name).toBe('beta-account');
        await service.update({ ...actor, key: 'alpha-events', action: 'pause' });
        const paused = await service.list(actor);
        expect(paused[0]?.syncs[0]?.state).toBe('paused');
        expect(paused[1]?.syncs[0]?.state).toBe('ready');
        expect(catalog.definitions.map(({ definition }) => definition.provider?.service)).toEqual([
          'alpha',
          'beta',
        ]);
        rejectAlpha = false;
        await service.update({ ...actor, key: 'alpha-events', action: 'resume' });
        await service.update({ ...actor, key: 'alpha-events', action: 'run' });
        await runtime.tick();
        await runtime.tick();
        expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('ready');
        const stored = await records.listResources({
          ownerId: OWNER_USER_ID,
          limit: 10,
          offset: 0,
        });
        expect(stored.items).toHaveLength(2);
        for (const provider of catalog.providers) {
          const summary = stored.items.find((record) => record.source.provider === provider.id)!;
          const resource = await records.findResource({
            ownerId: OWNER_USER_ID,
            readableId: summary.readableId,
          });
          expect(resource).toMatchObject({
            source: { provider: provider.id, kind: 'event', id: 'event-one', url: null },
            title: `${provider.id} event`,
            body: '# Event\n\nMeeting notes.',
            sourceCreatedAt: now,
            sourceUpdatedAt: now,
          });
        }
        for (const sync of runtime.api.syncs(scope)) {
          expect(runtime.api.deliveries({ ...scope, syncId: sync.id }).deliveries).toEqual([]);
        }
      } finally {
        await runtime.close();
      }
    },
  });
});

test('ambiguous provider and definition registrations are rejected', () => {
  const provider = fixtureProvider('example');
  expect(() => new SyncCatalog([provider, provider])).toThrow('Duplicate');
  expect(() => new SyncCatalog([{ ...provider, id: 'different' }])).toThrow('registered provider');
});
