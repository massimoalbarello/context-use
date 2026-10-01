import type { SyncRecord } from '@context-use/open-sync/record';
import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
export const playlistItemSchema = z.strictObject({
  title: z.string(),
  videoId: id,
  url: z.url(),
  channelId: id.nullable(),
  channel: z.string().nullable(),
  playlistId: id,
  playlistTitle: z.string(),
  playlistUrl: z.url(),
  addedAt: timestamp,
});
export const providerPlaylistSchema = z.object({
  id,
  snippet: z.object({ title: z.string(), channelId: id }),
});
export const providerPlaylistItemSchema = z.object({
  id,
  snippet: z.object({
    title: z.string(),
    playlistId: id,
    publishedAt: timestamp,
    resourceId: z.object({ kind: z.literal('youtube#video'), videoId: id }),
    // Private/deleted videos can omit uploader identity. Preserve the membership
    // and its timestamp instead of inventing a channel or dropping the item.
    videoOwnerChannelId: id.optional(),
    videoOwnerChannelTitle: z.string().optional(),
  }),
});
type PlaylistItem = z.infer<typeof providerPlaylistItemSchema>;
const playlistUrl = (id: string) =>
  `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;

export function playlistItemRecord({
  item,
  playlistTitle,
}: {
  item: PlaylistItem;
  playlistTitle: string;
}): SyncRecord {
  const snippet = item.snippet;
  const data: z.infer<typeof playlistItemSchema> = {
    title: snippet.title,
    videoId: snippet.resourceId.videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(snippet.resourceId.videoId)}`,
    channelId: snippet.videoOwnerChannelId ?? null,
    channel: snippet.videoOwnerChannelTitle ?? null,
    playlistId: snippet.playlistId,
    playlistTitle,
    playlistUrl: playlistUrl(snippet.playlistId),
    addedAt: snippet.publishedAt,
  };
  return {
    operation: 'upsert',
    kind: 'playlist-item',
    id: item.id,
    data,
    preview: data.title.trim() || 'Untitled YouTube video',
    createdAt: data.addedAt,
    content: {
      format: 'markdown',
      body: [
        `# ${data.title}`,
        `Video: ${data.url}`,
        `Channel: ${data.channel ?? 'Unavailable'}`,
        `Saved at: ${data.addedAt}`,
        `Playlist: ${data.playlistTitle}`,
        `Playlist URL: ${data.playlistUrl}`,
      ].join('\n\n'),
    },
  };
}
