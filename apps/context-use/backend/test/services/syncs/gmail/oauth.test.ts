import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSync } from '@context-use/open-sync';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { GMAIL_READONLY_SCOPE } from '#backend/services/syncs/sources/gmail/models.ts';
import { gmailProvider } from '#backend/services/syncs/sources/gmail/provider.ts';

test('Gmail authorization requests only readonly and persists app credentials through the encrypted runtime boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-gmail-oauth-'));
  const scope = { actorId: OWNER_USER_ID, ownerId: OWNER_USER_ID };
  const actor = { actorId: OWNER_USER_ID, providerId: 'gmail' };
  const options = {
    dataDirectory: directory,
    publicUrl: 'https://context.example/api/open-sync',
    authorize: () => scope,
    canConfigureProviders: () => Promise.resolve(true),
    definitions: [],
    destinationTypes: {},
  };
  try {
    const runtime = await createOpenSync(options);
    try {
      const service = new ManagedSyncsService({
        catalog: new SyncCatalog([gmailProvider]),
        sync: runtime,
      });
      await service.configureApp({
        ...actor,
        clientId: 'synthetic-client',
        clientSecret: 'synthetic-secret',
      });
      expect(JSON.stringify(await service.list(actor))).not.toContain('synthetic-secret');
    } finally {
      await runtime.close();
    }
    const restarted = await createOpenSync(options);
    try {
      const service = new ManagedSyncsService({
        catalog: new SyncCatalog([gmailProvider]),
        sync: restarted,
      });
      const authorization = new URL((await service.connect(actor)).authorizationUrl!);
      expect(authorization.origin).toBe('https://accounts.google.com');
      expect(authorization.searchParams.get('scope')?.split(/\s+/)).toEqual([GMAIL_READONLY_SCOPE]);
      expect(authorization.searchParams.get('redirect_uri')).toBe(
        'https://context.example/api/open-sync/oauth/callback',
      );
      expect(authorization.searchParams.get('access_type')).toBe('offline');
      expect(authorization.searchParams.get('prompt')).toBe('consent');
      expect(authorization.searchParams.get('state')).toBeTruthy();
      expect(restarted.api.syncs(scope)).toHaveLength(0);
    } finally {
      await restarted.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
