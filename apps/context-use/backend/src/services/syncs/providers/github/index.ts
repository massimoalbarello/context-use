import type { SyncProvider } from '../../catalog.ts';
import { githubPullRequests } from './pull-requests.ts';

export const githubProvider = {
  id: 'github',
  name: 'GitHub',
  description: 'Bring your authored pull requests into Context Use.',
  oauth: {
    createAppUrl: 'https://github.com/settings/applications/new',
    authorizationOptionIds: ['read:user', 'repo'],
  },
  syncs: [githubPullRequests],
} satisfies SyncProvider;
