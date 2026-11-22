import type { SyncProvider } from '../../catalog.ts';
import { youtubePlaylists } from './definition.ts';
import { INVALID_CHECKPOINT_CODE } from './request.ts';

export const youtubeProvider = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Bring videos saved to your playlists into Context Use.',
  oauth: { createAppUrl: 'https://console.cloud.google.com/auth/clients' },
  syncs: [
    {
      name: 'Playlist videos',
      description: 'Videos saved to your playlists.',
      invalidCheckpointCode: INVALID_CHECKPOINT_CODE,
      registration: youtubePlaylists,
    },
  ],
} satisfies SyncProvider;
