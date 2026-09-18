import type { SyncProvider } from '../../src/queries/managed-syncs';
export function providerFixture(): SyncProvider {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Bring your authored pull requests into Context Use.',
    oauthApp: {
      configured: false,
      clientId: null,
      callbackUrl: 'https://context.example/api/open-sync/oauth/callback',
      createAppUrl: 'https://github.com/settings/applications/new',
    },
    account: { name: null, status: 'disconnected' },
    syncs: [
      {
        key: 'github-pull-requests',
        name: 'Pull requests',
        description: 'Pull requests you authored.',
        provider: 'github',
        kinds: ['pull-request'],
        intervalMs: 900_000,
        state: 'setup-required',
        recordCount: 0,
        lastSyncedAt: null,
        nextSyncAt: null,
        message: 'Set up your OAuth app to get started.',
      },
    ],
  };
}
