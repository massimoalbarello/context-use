import { ForbiddenError } from '#backend/lib/errors.ts';
import type { ManagedSyncsServiceContract } from '#backend/services/syncs/managed.ts';
import { syncProviders } from '#backend/services/syncs/sources/index.ts';
import { DEMO_OWNER_ID } from './identity';

export function createDemoSyncs(): ManagedSyncsServiceContract {
  const deny = () => Promise.reject(new Error('Public demo syncs are read-only'));
  return {
    list: ({ actorId }) => {
      if (actorId !== DEMO_OWNER_ID) {
        return Promise.reject(new ForbiddenError());
      }
      return Promise.resolve(
        syncProviders.map((provider) => ({
          id: provider.id,
          name: provider.name,
          description: provider.description,
          oauthApp: {
            configured: false,
            callbackUrl: '/api/open-sync/oauth/callback',
            createAppUrl: provider.oauth.createAppUrl,
          },
          account: { name: null, status: 'disconnected' },
          syncs: [],
        })),
      );
    },
    configureApp: deny,
    connect: deny,
    completeConnection: deny,
    update: deny,
  };
}
