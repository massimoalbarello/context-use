import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderApi } from '@context-use/open-sync';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { granolaMeetings } from '#backend/services/syncs/sources/granola/meetings/definition.ts';
import { granolaProvider } from '#backend/services/syncs/sources/granola/provider.ts';

function unexpected(): never {
  throw new Error('Unexpected provider operation');
}
const actor = { actorId: OWNER_USER_ID, providerId: 'granola' };
const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
test('Granola validates API keys before replacing its OAuth connection and keeps the same sync and pause state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-granola-key-'));
  const connections: {
    id: string;
    account: string;
    service: string;
    authType: 'oauth2' | 'api_key';
    status: 'active';
  }[] = [
    { id: 'old-oauth', account: 'Owner', service: 'granola', authType: 'oauth2', status: 'active' },
  ];
  let fail = false;
  let saved = 0;
  const providers: ProviderApi = {
    configure: unexpected,
    start: unexpected,
    connection: unexpected,
    catalog: unexpected,
    connections: () => Promise.resolve(connections),
    status: () =>
      Promise.resolve({
        provider: {
          service: 'granola',
          displayName: 'Granola',
          iconUrl: null,
          categories: [],
          scenario: '',
          authTypes: ['api_key', 'oauth2'],
        },
        setup: { service: 'granola', auth: [] },
        connections,
      }),
    credentials: (input) => {
      expect(input).toMatchObject({
        ...scope,
        service: 'granola',
        authType: 'api_key',
        values: { apiKey: 'synthetic-key' },
      });
      if (fail) {
        return Promise.reject(new Error('upstream secret must not escape'));
      }
      saved++;
      if (!connections.some((item) => item.authType === 'api_key')) {
        expect(input.connectionId).toBeUndefined();
        connections.push({
          id: 'api-key',
          account: 'Granola API Key',
          service: 'granola',
          authType: 'api_key',
          status: 'active',
        });
      } else {
        expect(input.connectionId).toBe('api-key');
      }
      return Promise.resolve({ connected: true });
    },
  };
  const options = {
    databasePath: join(directory, 'sync.db'),
    definitions: [granolaMeetings],
    destinationTypes: {
      'local-records': {
        configSchema: { type: 'object' as const },
        deliver: () => Promise.resolve({ status: 'accepted' as const }),
      },
    },
    connector: {
      bind: () => Promise.resolve({ get: unexpected, post: unexpected, action: unexpected }),
    },
  };
  let runtime = createSyncRuntime(options);
  const service = () =>
    new ManagedSyncsService({
      catalog: new SyncCatalog([granolaProvider]),
      sync: { api: runtime.api, providers },
    });
  try {
    const original = await runtime.api.createSync({
      ...scope,
      definition: 'granola.meetings',
      connection: { id: 'old-oauth', service: 'granola' },
      config: {},
      destination: { type: 'local-records', input: {} },
    });
    expect((await service().list(actor))[0]).toMatchObject({
      oauthApp: null,
      account: { status: 'disconnected' },
      syncs: [{ state: 'disconnected' }],
    });
    const key = { ...actor, apiKey: 'synthetic-key' };
    await expect(service().configureApiKey({ ...key, actorId: 'other' })).rejects.toThrow(
      'Forbidden',
    );
    await expect(service().connect(actor)).rejects.toThrow('API key');
    fail = true;
    await expect(service().configureApiKey(key)).rejects.toThrow('Could not save your API key');
    expect(saved).toBe(0);
    expect(runtime.api.sync({ ...scope, id: original.id })).toMatchObject({
      enabled: true,
      connection: original.connection,
    });
    fail = false;
    await service().configureApiKey(key);
    expect(runtime.api.syncs(scope)).toHaveLength(1);
    expect(runtime.api.sync({ ...scope, id: original.id })).toMatchObject({
      enabled: true,
      connection: { id: 'api-key', service: 'granola' },
    });
    expect(JSON.stringify(await service().list(actor))).not.toContain('synthetic-key');
    expect((await service().list(actor))[0]).toMatchObject({
      oauthApp: null,
      account: { status: 'connected' },
    });
    await service().update({ ...actor, key: 'granola.meetings', action: 'pause' });
    await service().configureApiKey(key);
    expect(runtime.api.sync({ ...scope, id: original.id }).enabled).toBe(false);
    await runtime.close();
    runtime = createSyncRuntime(options);
    await service().configureApiKey(key);
    expect(runtime.api.syncs(scope)).toHaveLength(1);
    expect(runtime.api.sync({ ...scope, id: original.id })).toMatchObject({
      enabled: false,
      connection: { id: 'api-key', service: 'granola' },
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
