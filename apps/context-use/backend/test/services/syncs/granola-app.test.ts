import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSync } from '@context-use/open-sync';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/sources/index.ts';

const actor = { actorId: OWNER_USER_ID, providerId: 'granola' };
test('Granola connects without manual app setup and reuses registered credentials after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-granola-app-'));
  let registrations = 0;
  const options = {
    dataDirectory: directory,
    publicUrl: 'https://context.example/api/open-sync',
    authorize: () => ({ ...actor, ownerId: OWNER_USER_ID }),
    canConfigureProviders: () => Promise.resolve(true),
    definitions: [],
    destinationTypes: {},
    oauthClientRegistrations: {
      granola: ({ redirectUri }: { redirectUri: string }) => {
        expect(redirectUri).toBe('https://context.example/api/open-sync/oauth/callback');
        registrations++;
        return Promise.resolve({ clientId: 'synthetic-public-client' });
      },
    },
  };
  try {
    for (const _restart of [false, true]) {
      const sync = await createOpenSync(options);
      try {
        const service = new ManagedSyncsService({ catalog: new SyncCatalog(syncProviders), sync });
        const granola = (await service.list(actor)).find((item) => item.id === 'granola')!;
        expect(granola.oauthApp).toMatchObject({ automaticRegistration: true, createAppUrl: null });
        expect(granola.syncs[0]?.state).toBe('disconnected');
        expect(granola.account.name).toBeNull();
        const before = registrations;
        await expect(service.connect({ actorId: 'other', providerId: 'granola' })).rejects.toThrow(
          'Forbidden',
        );
        expect(registrations).toBe(before);
        await expect(
          service.configureApp({ ...actor, clientId: 'client', clientSecret: 'secret' }),
        ).rejects.toThrow('automatically');
        const authorization = new URL((await service.connect(actor)).authorizationUrl!);
        expect(authorization.origin).toBe('https://mcp-auth.granola.ai');
        expect(authorization.searchParams.get('client_id')).toBe('synthetic-public-client');
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
        expect(
          (await service.list(actor)).find((item) => item.id === 'granola')?.oauthApp.configured,
        ).toBe(true);
        expect(registrations).toBe(1);
      } finally {
        await sync.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
