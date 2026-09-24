import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderApi } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { LOCAL_RECORD_DESTINATION } from '#backend/models/syncs/managed.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { fixtureProvider } from './provider-fixture';

function unexpected(): never {
  throw new Error('Unexpected provider call');
}

test('provider registrations share management and destination code while delivery queues and actions stay isolated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-catalog-'));
  const alpha = fixtureProvider('alpha');
  const beta = fixtureProvider('beta');
  const catalog = new SyncCatalog([alpha, beta]);
  let rejectAlpha = true;
  const runtime = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: catalog.definitions,
    connector: { bind: async () => ({ get: unexpected, post: unexpected, action: unexpected }) },
    destinationTypes: {
      [LOCAL_RECORD_DESTINATION]: {
        configSchema: { type: 'object' },
        deliver: ({ deliverable }) =>
          Promise.resolve(
            rejectAlpha && deliverable.definition === 'alpha.events'
              ? { status: 'rejected', code: 'test_rejection' }
              : { status: 'accepted' },
          ),
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
    await expect(service.connect({ ...actor, providerId: 'missing' })).rejects.toThrow('not found');
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
    for (const sync of runtime.api.syncs(scope)) {
      expect(runtime.api.deliveries({ ...scope, syncId: sync.id }).deliveries).toEqual([]);
    }
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ambiguous provider and definition registrations are rejected', () => {
  const provider = fixtureProvider('example');
  expect(() => new SyncCatalog([provider, provider])).toThrow('Duplicate');
  expect(() => new SyncCatalog([{ ...provider, id: 'different' }])).toThrow('registered provider');
});
