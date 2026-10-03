import type { SyncProvider } from '../../catalog.ts';
import { youtubePlaylists } from './definition.ts';

export const youtubeProvider = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Bring videos saved to your playlists into Context Use.',
  oauth: { createAppUrl: 'https://console.cloud.google.com/auth/clients' },
  syncs: [
    {
      name: 'Playlist videos',
      description: 'Videos saved to your playlists.',
      registration: youtubePlaylists,
    },
  ],
} satisfies SyncProvider;
