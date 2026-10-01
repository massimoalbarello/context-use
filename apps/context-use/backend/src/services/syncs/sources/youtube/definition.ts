import type { SyncRegistration } from '@context-use/open-sync/definition';
import { z } from 'zod';
import { checkpointSchema, initialCheckpoint } from './models.ts';
import { step } from './playlists.ts';
import { playlistItemSchema } from './records.ts';

export const youtubePlaylists = {
  definition: {
    id: 'youtube.playlists',
    name: 'YouTube playlist videos',
    description:
      'Videos saved to your owned playlists with title, channel, URL, saved time, and playlist name and URL. Backfills once, then checks each final page for appended entries. Requires append-only API order; old edits/removals are not tracked. Expired item cursors require an explicit resync. Excludes Watch Later and playlists owned by others.',
    provider: {
      service: 'youtube',
      actions: [],
      proxyPaths: ['/youtube/v3/channels', '/youtube/v3/playlists', '/youtube/v3/playlistItems'],
    },
    configSchema: { type: 'object', additionalProperties: false },
    checkpointSchema: JSON.parse(JSON.stringify(z.toJSONSchema(checkpointSchema))),
    initialCheckpoint,
    kinds: {
      'playlist-item': JSON.parse(JSON.stringify(z.toJSONSchema(playlistItemSchema))),
    },
  },
  load: () => ({ step }),
} satisfies SyncRegistration;
