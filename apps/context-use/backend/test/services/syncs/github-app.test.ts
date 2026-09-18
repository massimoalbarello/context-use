import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSync } from '@context-use/open-sync';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/providers/index.ts';

const actor = { actorId: OWNER_USER_ID, providerId: 'github' };
test('OAuth app credentials persist through the installed package without becoming account authorization or leaking its secret in status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-github-app-'));
  const options = {
    dataDirectory: directory,
    publicUrl: 'https://context.example/api/open-sync',
    authorize: () => ({ ...actor, ownerId: OWNER_USER_ID }),
    canConfigureProviders: () => Promise.resolve(true),
    definitions: [],
    destinationTypes: {},
  };
  try {
    const first = await createOpenSync(options);
    try {
      const service = new ManagedSyncsService({
        catalog: new SyncCatalog(syncProviders),
        sync: first,
        countRecords: () => Promise.resolve(0),
      });
      expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('setup-required');
      await service.configureApp({
        ...actor,
        clientId: 'synthetic-client',
        clientSecret: 'synthetic-secret',
      });
      const status = (await service.list(actor))[0]!;
      expect(status.syncs[0]?.state).toBe('disconnected');
      expect(status.oauthApp).toMatchObject({
        configured: true,
        callbackUrl: 'https://context.example/api/open-sync/oauth/callback',
      });
      expect(status.account.name).toBeNull();
      expect(status.oauthApp).not.toHaveProperty('clientId');
      expect(JSON.stringify(status)).not.toContain('synthetic-secret');
    } finally {
      await first.close();
    }
    const restarted = await createOpenSync(options);
    try {
      const service = new ManagedSyncsService({
        catalog: new SyncCatalog(syncProviders),
        sync: restarted,
        countRecords: () => Promise.resolve(0),
      });
      expect((await service.list(actor))[0]?.oauthApp.configured).toBe(true);
      const persistedAuthorization = new URL((await service.connect(actor)).authorizationUrl!);
      expect(persistedAuthorization.searchParams.get('client_id')).toBe('synthetic-client');
      expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('disconnected');
      await service.configureApp({
        ...actor,
        clientId: 'updated-client',
        clientSecret: 'updated-secret',
      });
      const status = await service.list(actor);
      expect(status[0]?.oauthApp.configured).toBe(true);
      expect(JSON.stringify(status)).not.toContain('updated-secret');
      const authorization = new URL((await service.connect(actor)).authorizationUrl!);
      expect(authorization.origin).toBe('https://github.com');
      expect(authorization.searchParams.get('client_id')).toBe('updated-client');
      expect(authorization.searchParams.get('redirect_uri')).toBe(
        'https://context.example/api/open-sync/oauth/callback',
      );
      expect(authorization.searchParams.get('scope')?.split(/[ ,]+/).sort()).toEqual([
        'read:user',
        'repo',
      ]);
      expect((await service.list(actor))[0]?.account.name).toBeNull();
    } finally {
      await restarted.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
