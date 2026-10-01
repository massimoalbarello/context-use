import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import { z } from 'zod';
import {
  type Checkpoint,
  checkpointSchema,
  initialCheckpoint,
  nextPage,
  pageSize,
  paginationSchema,
} from './models.ts';
import {
  playlistItemRecord,
  providerPlaylistItemSchema,
  providerPlaylistSchema,
} from './records.ts';
import { ExpiredPageToken, InvalidCheckpoint, PlaylistNotFound, request } from './request.ts';

const channelsPath = '/youtube/v3/channels';
const playlistsPath = '/youtube/v3/playlists';
const itemsPath = '/youtube/v3/playlistItems';
const directorySchema = paginationSchema.extend({ items: z.array(providerPlaylistSchema).max(1) });
const itemsSchema = paginationSchema.extend({
  items: z.array(providerPlaylistItemSchema).max(pageSize),
});
const identitySchema = z.object({
  items: z.array(z.object({ id: z.string().min(1) })).length(1),
  nextPageToken: z.never().optional(),
});

export async function step(context: SyncContext): Promise<SyncStep> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const identity = identitySchema.parse(
    await request({
      context,
      path: channelsPath,
      query: { part: 'id', mine: true, maxResults: pageSize },
    }),
  );
  const account = identity.items[0]!.id;
  if (checkpoint.account && checkpoint.account !== account) {
    throw new Error('YouTube channel changed. Create a new sync.');
  }
  const saved = { ...checkpoint, account };
  try {
    const active = await readPlaylist({ context, checkpoint: saved });
    const page = active.checkpoint.playlistId
      ? await readItems({ context, checkpoint: active.checkpoint })
      : { records: [], checkpoint: active.checkpoint, itemPageToken: null };
    context.signal.throwIfAborted();
    return finish({ ...page, records: [...active.records, ...page.records] });
  } catch (error) {
    return recover({ checkpoint: saved, error });
  }
}

async function readItems(input: { context: SyncContext; checkpoint: Checkpoint }) {
  const { context, checkpoint } = input;
  const playlistId = checkpoint.playlistId!;
  const page = itemsSchema.parse(
    await request({
      context,
      path: itemsPath,
      query: {
        part: 'snippet',
        playlistId,
        maxResults: pageSize,
        // Only acquire metadata needed for pagination and video records;
        // descriptions, thumbnails, media, and transcripts are excluded.
        fields:
          'nextPageToken,pageInfo(totalResults),items(id,snippet(title,playlistId,position,publishedAt,resourceId,videoOwnerChannelId,videoOwnerChannelTitle))',
        ...(checkpoint.itemPageToken ? { pageToken: checkpoint.itemPageToken } : {}),
      },
    }),
  );
  if (
    page.items.some((item) => item.snippet.playlistId !== playlistId) ||
    new Set(page.items.map((item) => item.id)).size !== page.items.length
  ) {
    throw new Error('YouTube returned duplicate or foreign playlist items.');
  }
  const tail = checkpoint.tails[playlistId];
  if (tail && page.pageInfo.totalResults < tail.itemCount) {
    throw new InvalidCheckpoint(
      'YouTube playlist is no longer append-only. Syncing has been paused.',
    );
  }
  const itemPageToken = nextPage({
    page,
    previous: checkpoint.itemPageToken,
    count: page.items.length,
  });
  const pageOffset = tail
    ? checkpoint.itemPageToken === tail.pageToken
      ? tail.pageOffset
      : tail.itemCount
    : 0;
  for (const [index, item] of page.items.entries()) {
    if (item.snippet.position !== pageOffset + index) {
      throw new InvalidCheckpoint(
        'YouTube item positions no longer match saved progress. Syncing has been paused.',
      );
    }
  }
  const itemCount = pageOffset + page.items.length;
  if (
    itemCount < (tail?.itemCount ?? 0) ||
    itemCount > page.pageInfo.totalResults ||
    Boolean(itemPageToken) !== itemCount < page.pageInfo.totalResults
  ) {
    throw new Error('YouTube returned incomplete pagination.');
  }
  return {
    records: page.items
      .filter((item) => item.snippet.position >= (tail?.itemCount ?? 0))
      .map((item) => playlistItemRecord({ item, playlistTitle: checkpoint.playlistTitle! })),
    checkpoint: {
      ...checkpoint,
      // Count only complete memberships committed with this page, never the
      // directory's prospective total. Restart can then resume the remaining delta.
      tails: {
        ...checkpoint.tails,
        [playlistId]: { pageToken: checkpoint.itemPageToken, pageOffset, itemCount },
      },
    },
    itemPageToken,
  };
}

async function readPlaylist(input: { context: SyncContext; checkpoint: Checkpoint }) {
  const { context, checkpoint } = input;
  if (checkpoint.playlistId) {
    return { records: [] as SyncRecord[], checkpoint };
  }
  // One directory resource per page bounds active context without checkpointing
  // a pending ID list or repeating earlier discovery while reading item pages.
  const page = directorySchema.parse(
    await request({
      context,
      path: playlistsPath,
      query: {
        part: 'snippet,contentDetails',
        mine: true,
        maxResults: 1,
        fields:
          'nextPageToken,pageInfo(totalResults),items(id,snippet(title,channelId),contentDetails(itemCount))',
        ...(checkpoint.directoryPageToken ? { pageToken: checkpoint.directoryPageToken } : {}),
      },
    }),
  );
  const directoryPageToken = nextPage({
    page,
    previous: checkpoint.directoryPageToken,
    count: page.items.length,
  });
  const playlist = page.items[0];
  if (playlist && playlist.snippet.channelId !== checkpoint.account) {
    throw new Error('YouTube returned a playlist owned by another channel.');
  }
  const tail = playlist ? checkpoint.tails[playlist.id] : undefined;
  if (playlist && tail && playlist.contentDetails.itemCount < tail.itemCount) {
    throw new InvalidCheckpoint(
      'YouTube playlist is no longer append-only. Syncing has been paused.',
    );
  }
  const changed = playlist && (!tail || playlist.contentDetails.itemCount > tail.itemCount);
  return {
    records: [] as SyncRecord[],
    checkpoint: {
      ...checkpoint,
      directoryPageToken,
      playlistId: changed ? playlist.id : null,
      playlistTitle: changed ? playlist.snippet.title : null,
      itemPageToken: changed ? (tail?.pageToken ?? null) : null,
    },
  };
}

function recover(input: { checkpoint: Checkpoint; error: unknown }): SyncStep {
  const { checkpoint, error } = input;
  if (error instanceof ExpiredPageToken) {
    if (error.path === itemsPath) {
      throw new InvalidCheckpoint('YouTube item page token expired. Syncing has been paused.');
    }
    if (error.path === playlistsPath && checkpoint.directoryPageToken) {
      // Directory discovery is small and must run each poll for new playlists.
      // Recovery keeps every append frontier, so archived item pages are not replayed.
      return {
        records: [],
        checkpoint: { ...initialCheckpoint, account: checkpoint.account, tails: checkpoint.tails },
        complete: false,
      };
    }
  }
  // Disappearance does not delete archived records. A forbidden response cannot
  // prove deletion and must fail the step instead of advancing it.
  if (error instanceof PlaylistNotFound && checkpoint.playlistId) {
    return finish({ records: [], checkpoint, itemPageToken: null });
  }
  throw error;
}

function finish(input: {
  records: readonly SyncRecord[];
  checkpoint: Checkpoint;
  itemPageToken: string | null;
}): SyncStep {
  const complete = !input.itemPageToken && !input.checkpoint.directoryPageToken;
  return {
    records: input.records,
    // PublishedAt is membership creation, not an update watermark. Counts gate
    // polling and positions select the new append delta; opaque native tokens
    // resume acquisition without replaying earlier archive pages.
    checkpoint: complete
      ? { ...initialCheckpoint, account: input.checkpoint.account, tails: input.checkpoint.tails }
      : {
          ...input.checkpoint,
          playlistId: input.itemPageToken ? input.checkpoint.playlistId : null,
          playlistTitle: input.itemPageToken ? input.checkpoint.playlistTitle : null,
          itemPageToken: input.itemPageToken,
        },
    complete,
  };
}
