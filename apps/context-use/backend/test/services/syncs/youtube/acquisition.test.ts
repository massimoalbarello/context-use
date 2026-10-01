const badRequest = 400;
const forbidden = 403;
const unavailable = 503;
const laterAppends = 30;

import { expect, test } from 'bun:test';
import { youtubePlaylists } from '#backend/services/syncs/sources/youtube/definition.ts';
import { pageSize } from '#backend/services/syncs/sources/youtube/models.ts';
import { fixture, owner } from './fixture.ts';
import {
  addedAt,
  archiveCount,
  archiveRecordCount,
  failure,
  item,
  memberships,
  reply,
  youtubeFixture,
} from './youtube-fixture.ts';

// The external API is simulated; the engine, SQLite checkpoint/outbox, change
// detection, restart, and delivery are real. A live YouTube test must establish
// how long page tokens remain reusable and verify the playlist's append order.
test('YouTube backfills, resumes exactly at the next page, and polls only the final page plus new pages', async () => {
  const source = youtubeFixture();
  const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({
      account: 'owner',
      tails: {},
      directoryPageToken: 'directory-b',
      playlistId: 'a',
      playlistTitle: 'Playlist a',
      itemPageToken: 'opaque-fifty',
    });
    await f.restart();
    await f.finish();
    expect(source.itemRequests).toEqual([
      ['a', null],
      ['a', 'opaque-fifty'],
      ['a', 'opaque-hundred'],
      ['b', null],
    ]);
    expect(source.requests.filter(({ path }) => path.endsWith('/playlists'))).toHaveLength(2);
    const initialCount = archiveRecordCount;
    expect(f.records).toHaveLength(initialCount);
    expect(f.saved.checkpoint).toEqual({
      account: 'owner',
      directoryPageToken: null,
      playlistId: null,
      playlistTitle: null,
      itemPageToken: null,
      tails: {
        a: { pageToken: 'opaque-hundred', itemCount: archiveCount },
        b: { pageToken: null, itemCount: 1 },
      },
    });
    expect(f.records.find((record) => record.id === 'a-membership-0')).toMatchObject({
      kind: 'playlist-item',
      createdAt: new Date(addedAt).toISOString(),
      data: {
        title: 'Video 0',
        channel: 'Uploader',
        channelId: 'uploader',
        url: 'https://www.youtube.com/watch?v=video-0',
        playlistId: 'a',
        addedAt,
      },
    });
    expect(f.records.find((record) => record.id === 'b-membership-0')).toBeDefined();
    await f.restart();
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(source.itemRequests).toEqual([
      ['a', 'opaque-hundred'],
      ['b', null],
    ]);
    expect(f.records).toHaveLength(initialCount);
    const appendedCount = 43;
    source.listings
      .get('a')!
      .push(...memberships({ playlistId: 'a', count: appendedCount, start: archiveCount }));
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(source.itemRequests).toEqual([
      ['a', 'opaque-hundred'],
      ['a', 'opaque-one-fifty'],
      ['b', null],
    ]);
    expect(f.records).toHaveLength(initialCount + appendedCount);
    expect(f.saved.checkpoint.tails.a).toEqual({
      pageToken: 'opaque-one-fifty',
      itemCount: archiveCount + appendedCount,
    });
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(source.itemRequests).toEqual([
      ['a', 'opaque-one-fifty'],
      ['b', null],
    ]);
    expect(f.records).toHaveLength(initialCount + appendedCount);
    source.listings.set('c', [item({ playlistId: 'c', index: 0 })]);
    f.queue();
    await f.finish();
    expect(f.records.filter((record) => record.id.startsWith('c'))).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test.each(['empty', 'full'] as const)(
  'YouTube %s final page can acquire later appends without a synthesized cursor',
  async (mode) => {
    const source = youtubeFixture();
    const count = mode === 'full' ? pageSize : 0;
    source.listings.clear();
    source.listings.set('a', memberships({ playlistId: 'a', count }));
    const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
    try {
      await f.finish();
      expect(f.saved.checkpoint.tails.a).toEqual({ pageToken: null, itemCount: count });
      source.requests.length = 0;
      source.listings.get('a')!.push(item({ playlistId: 'a', index: count }));
      f.queue();
      await f.finish();
      expect(source.itemRequests).toEqual(
        mode === 'full'
          ? [
              ['a', null],
              ['a', 'opaque-fifty'],
            ]
          : [['a', null]],
      );
      expect(f.records).toHaveLength(count + 1);
    } finally {
      await f.close();
    }
  },
);

test('YouTube a transient failure commits neither the page nor its cursor, then restart retries only that page', async () => {
  const source = youtubeFixture();
  const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
  try {
    await f.engine.tick();
    const committed = f.saved.checkpoint;
    source.intercept = ({ path, query }) =>
      path.endsWith('/playlistItems') && query.pageToken === 'opaque-fifty'
        ? failure({ reason: 'backendError', status: unavailable })
        : undefined;
    await f.engine.tick();
    expect(f.saved).toMatchObject({
      checkpoint: committed,
      errorCode: 'source_http_503',
      status: 'retrying',
    });
    expect(f.records.filter((record) => record.id === 'a-membership-pageSize')).toHaveLength(0);
    await f.restart();
    source.intercept = undefined;
    f.queue();
    await f.finish();
    expect(source.itemRequests.filter(([id, token]) => id === 'a' && token === null)).toHaveLength(
      1,
    );
    expect(
      source.itemRequests.filter(([id, token]) => id === 'a' && token === 'opaque-fifty'),
    ).toHaveLength(2);
    expect(f.records).toHaveLength(archiveRecordCount);
  } finally {
    await f.close();
  }
});

test.each(['expired', 'rejected', 'shrunken'] as const)(
  'YouTube %s append frontier pauses without silently refetching the archive',
  async (mode) => {
    const source = youtubeFixture();
    const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
    try {
      await f.finish();
      const committed = f.saved.checkpoint;
      source.requests.length = 0;
      if (mode === 'expired') {
        source.intercept = ({ path }) =>
          path.endsWith('/playlistItems')
            ? failure({ reason: 'invalidPageToken', status: badRequest })
            : undefined;
      } else if (mode === 'rejected') {
        source.intercept = ({ path }) =>
          path.endsWith('/playlistItems')
            ? Promise.reject(
                Object.assign(new Error('connector request failed'), {
                  code: 'connector_request_failed',
                  status: badRequest,
                  diagnostics: {
                    service: 'youtube',
                    operation: path,
                    providerStatus: badRequest,
                  },
                }),
              )
            : undefined;
      } else {
        source.listings.get('a')!.pop();
      }
      await f.restart();
      f.queue();
      await f.engine.tick();
      expect(f.saved).toMatchObject({
        checkpoint: committed,
        errorCode: 'youtube_checkpoint_invalid_resync_required',
        status: 'disabled',
        enabled: false,
      });
      expect(source.itemRequests).toEqual([['a', 'opaque-hundred']]);
      expect(f.records).toHaveLength(archiveRecordCount);
      source.intercept = undefined;
      await f.engine.api.setEnabled({ ...owner, id: f.saved.id, enabled: true });
      await f.engine.api.resync({ ...owner, id: f.saved.id });
      f.queue();
      await f.finish();
      expect(source.itemRequests).toContainEqual(['a', null]);
      // An explicit resync intentionally republishes the archive; stable IDs
      // let an upsert destination keep the original record identity.
      const replayedCount = mode === 'shrunken' ? archiveRecordCount - 1 : archiveRecordCount;
      expect(f.records).toHaveLength(archiveRecordCount + replayedCount);
      expect(new Set(f.records.map((record) => `${record.kind}:${record.id}`)).size).toBe(
        archiveRecordCount,
      );
    } finally {
      await f.close();
    }
  },
);

test('YouTube expired directory tokens replay discovery while retaining every completed append frontier', async () => {
  const source = youtubeFixture();
  const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
  try {
    await f.finish();
    source.requests.length = 0;
    f.queue();
    await f.engine.tick();
    source.intercept = ({ path, query }) =>
      path.endsWith('/playlists') && query.pageToken
        ? failure({ reason: 'invalidPageToken', status: badRequest })
        : undefined;
    const tails = f.saved.checkpoint.tails;
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({
      account: 'owner',
      tails,
      directoryPageToken: null,
      playlistId: null,
      playlistTitle: null,
      itemPageToken: null,
    });
    await f.restart();
    source.intercept = undefined;
    await f.finish();
    expect(source.itemRequests).toEqual([
      ['a', 'opaque-hundred'],
      ['a', 'opaque-hundred'],
      ['b', null],
    ]);
    expect(f.records).toHaveLength(archiveRecordCount);
  } finally {
    await f.close();
  }
});

test.each(['foreign-item', 'duplicate-item', 'truncated', 'quota', 'forbidden'] as const)(
  'YouTube %s response does not commit partial video output or advance the checkpoint',
  async (mode) => {
    const source = youtubeFixture();
    source.intercept = ({ path }) => {
      if (!path.endsWith('/playlistItems')) {
        return undefined;
      }
      if (mode === 'quota') {
        return failure({ reason: 'quotaExceeded', status: forbidden });
      }
      if (mode === 'forbidden') {
        return failure({ reason: 'playlistItemsNotAccessible', status: forbidden });
      }
      return reply({
        items:
          mode === 'foreign-item'
            ? [item({ playlistId: 'foreign', index: 0 })]
            : mode === 'duplicate-item'
              ? [item({ playlistId: 'a', index: 0 }), item({ playlistId: 'a', index: 0 })]
              : [item({ playlistId: 'a', index: 0 })],
        pageInfo: { totalResults: mode === 'truncated' ? 2 : 1 },
      });
    };
    const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
    try {
      const initial = f.saved.checkpoint;
      await f.engine.tick();
      expect(f.saved.checkpoint).toEqual(initial);
      expect(f.engine.api.status(owner).queue.pendingRecords).toBe(0);
      expect(f.records).toHaveLength(0);
      expect(f.saved.errorCode).toBe(
        mode === 'quota'
          ? 'source_http_429'
          : mode === 'forbidden'
            ? 'source_http_403'
            : 'execution_failed',
      );
      expect(f.saved.status).toBe(mode === 'forbidden' ? 'disabled' : 'retrying');
      await f.restart();
      source.intercept = undefined;
      await f.engine.api.setEnabled({ ...owner, id: f.saved.id, enabled: true });
      f.queue();
      await f.finish();
      expect(f.records).toHaveLength(archiveRecordCount);
    } finally {
      await f.close();
    }
  },
);

test('YouTube changed accounts fail before foreign data is read, and disappearing playlists keep their archive', async () => {
  const source = youtubeFixture();
  const f = await fixture({ registration: youtubePlaylists, provider: source.provider });
  try {
    await f.finish();
    const committed = f.saved.checkpoint;
    source.requests.length = 0;
    source.account = 'other';
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(committed);
    expect(source.itemRequests).toHaveLength(0);
    source.account = 'owner';
    source.listings.delete('b');
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(archiveRecordCount);
    // A positively identified disappearance of an active playlist can complete
    // its scan. A permission failure, exercised above, must never do this.
    source.listings
      .get('a')!
      .push(...memberships({ playlistId: 'a', count: laterAppends, start: archiveCount }));
    f.queue();
    await f.engine.tick();
    source.listings.delete('a');
    await f.finish();
    expect(f.records.filter((record) => record.operation === 'delete')).toHaveLength(0);
  } finally {
    await f.close();
  }
});
