import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderApi } from '@context-use/open-sync';
import { SourceHttpError } from '@context-use/open-sync/definition';
import { createSyncRuntime } from '@context-use/open-sync/engine';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/providers/index.ts';
import { githubPullRequests } from '#backend/services/syncs/sources/github/pull-requests.ts';

function unexpected(): never {
  throw new Error('Unexpected provider call');
}

test('managed connection is owner-scoped, starts once, and exposes pause/resume without engine identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-managed-sync-'));
  let providerError: SourceHttpError | undefined;
  const runtime = createSyncRuntime({
    databasePath: join(directory, 'sync.db'),
    definitions: [githubPullRequests.registration],
    destinationTypes: {
      'local-records': {
        configSchema: { type: 'object' },
        deliver: () => Promise.resolve({ status: 'accepted' }),
      },
    },
    connector: {
      bind: () =>
        Promise.resolve({
          get: unexpected,
          post: () => Promise.reject(providerError ?? new Error('Unavailable')),
          action: unexpected,
        }),
    },
  });
  let connected = false;
  let configured = false;
  const connections = () =>
    connected ? [{ id: 'connection', service: 'github', account: 'octocat' }] : [];
  const providers: ProviderApi = {
    credentials: unexpected,
    connections: () => Promise.resolve(connections()),
    status: () =>
      Promise.resolve({
        provider: {
          service: 'github',
          displayName: 'GitHub',
          iconUrl: null,
          categories: [],
          scenario: '',
          authTypes: ['oauth2'],
        },
        setup: {
          service: 'github',
          auth: [],
          oauthClient: {
            configured,
            customClientAvailable: false,
            expectedRedirectUri: 'https://host/api/open-sync/oauth/callback',
            missingFields: [],
          },
        },
        connections: connections().map((connection) => ({
          ...connection,
          status: 'active',
          authType: 'oauth2' as const,
        })),
      }),
    configure: ({ actorId, ownerId, values }) => {
      expect(actorId).toBe(OWNER_USER_ID);
      expect(ownerId).toBe(OWNER_USER_ID);
      expect(values).toEqual({ clientId: 'client', clientSecret: 'secret' });
      configured = true;
      return Promise.resolve({ configured: true });
    },
    start: () => Promise.resolve({ authorizationUrl: 'https://github.com/login/oauth/authorize' }),
    connection: unexpected,
    catalog: unexpected,
  };
  const service = new ManagedSyncsService({
    catalog: new SyncCatalog(syncProviders),
    sync: { api: runtime.api, providers },
  });
  const actor = { actorId: OWNER_USER_ID, providerId: 'github' };
  try {
    await expect(service.list({ actorId: 'other' })).rejects.toThrow('Forbidden');
    expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('setup-required');
    await expect(service.connect(actor)).rejects.toThrow('Set up');
    await expect(
      service.configureApp({
        actorId: 'other',
        providerId: 'github',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).rejects.toThrow('Forbidden');
    expect(configured).toBe(false);
    await service.configureApp({ ...actor, clientId: 'client', clientSecret: 'secret' });
    expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('disconnected');
    expect((await service.list(actor))[0]?.account.name).toBeNull();
    expect((await service.connect(actor)).authorizationUrl).toContain('github.com');
    expect(runtime.api.syncs({ ...actor, ownerId: OWNER_USER_ID })).toHaveLength(0);
    // Recover when credentials were saved but sync creation was interrupted.
    connected = true;
    const interrupted = (await service.list(actor))[0]!;
    expect(interrupted.syncs[0]?.state).toBe('disconnected');
    expect(interrupted.account.name).toBe('octocat');
    const attempts = await Promise.allSettled([service.connect(actor), service.connect(actor)]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(2);
    const scope = { ...actor, ownerId: OWNER_USER_ID };
    expect(runtime.api.syncs(scope)).toHaveLength(1);
    const syncBeforeEdit = runtime.api.syncs(scope)[0];
    await service.configureApp({ ...actor, clientId: 'client', clientSecret: 'secret' });
    expect(runtime.api.syncs(scope)[0]).toEqual(syncBeforeEdit);
    expect((await service.list(actor))[0]?.account.name).toBe('octocat');
    await service.completeConnection(actor);
    expect(runtime.api.syncs(scope)).toHaveLength(1);
    await service.update({ ...actor, key: githubPullRequests.key, action: 'pause' });
    expect((await service.list(actor))[0]?.syncs[0]).toMatchObject({
      state: 'paused',
      message: 'Automatic syncing is paused. Your records are kept.',
    });
    await expect(
      service.update({ ...actor, key: githubPullRequests.key, action: 'run' }),
    ).rejects.toThrow('Resume');
    await service.update({ ...actor, key: githubPullRequests.key, action: 'resume' });
    const summary = (await service.list(actor))[0]!;
    expect(summary.account.name).toBe('octocat');
    expect(summary.syncs[0]?.state).toBe('syncing');
    expect(JSON.stringify(summary)).not.toContain('sync_');
    expect(JSON.stringify(summary)).not.toContain('secret');
    await runtime.tick();
    const failed = (await service.list(actor))[0]!;
    expect(failed.syncs[0]?.state).toBe('error');
    expect(failed.oauthApp.configured).toBe(true);
    expect(failed.account.name).toBe('octocat');
    expect(failed.syncs[0]?.message).toBe(
      'This sync could not finish. Automatic retries continue.',
    );
    providerError = new SourceHttpError({ status: 401 });
    await service.update({ ...actor, key: githubPullRequests.key, action: 'run' });
    await runtime.tick();
    expect((await service.list(actor))[0]?.syncs[0]).toMatchObject({
      state: 'paused',
      nextSyncAt: null,
      message: 'Syncing paused after a provider error. Check your account access before resuming.',
    });
    await service.update({ ...actor, key: githubPullRequests.key, action: 'resume' });
    expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('syncing');
    await expect(service.update({ ...actor, key: 'missing', action: 'pause' })).rejects.toThrow(
      'Sync not found.',
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
