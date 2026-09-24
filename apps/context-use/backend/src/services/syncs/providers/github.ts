import type { SyncProvider } from '../catalog.ts';
import { githubPullRequests } from '../sources/github/pull-requests.ts';

export const githubProvider = {
  id: 'github',
  name: 'GitHub',
  description: 'Bring your authored pull requests into Context Use.',
  oauth: {
    createAppUrl: 'https://github.com/settings/applications/new',
    authorizationOptionIds: ['read:user', 'repo'],
  },
  syncs: [
    {
      name: 'Pull requests',
      description: 'Pull requests you authored, saved as searchable records.',
      intervalMs: 900_000,
      registration: githubPullRequests,
    },
  ],
} satisfies SyncProvider;
