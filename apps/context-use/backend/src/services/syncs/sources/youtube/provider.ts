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
      description:
        'Saved videos with channel, saved time, and playlist details. Append new videos at the end; older edits and removals are not tracked. If saved progress expires, use Backfill again. Enable YouTube Data API v3 in your OAuth project.',
      intervalMs: 900_000,
      registration: youtubePlaylists,
    },
  ],
} satisfies SyncProvider;
