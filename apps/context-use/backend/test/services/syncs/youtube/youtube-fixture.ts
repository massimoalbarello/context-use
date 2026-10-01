import type { ProviderOperations, ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { pageSize } from '#backend/services/syncs/sources/youtube/models.ts';
import { unused } from './fixture.ts';

export const addedAt = '2020-01-02T03:04:05Z';
export function playlist(id: string): JsonObject {
  return {
    id,
    snippet: {
      title: `Playlist ${id}`,
      description: '',
      channelId: 'owner',
      channelTitle: 'Owner',
      publishedAt: addedAt,
    },
    status: { privacyStatus: 'private' },
  };
}
export function item({ playlistId, index }: { playlistId: string; index: number }): JsonObject {
  return {
    id: `${playlistId}-membership-${index}`,
    snippet: {
      title: `Video ${index}`,
      playlistId,
      publishedAt: addedAt,
      resourceId: { kind: 'youtube#video', videoId: `video-${index}` },
      videoOwnerChannelId: 'uploader',
      videoOwnerChannelTitle: 'Uploader',
    },
  };
}
export const archiveCount = 121;
export const archiveRecordCount = archiveCount + 1;
const badRequest = 400;
const notFound = 404;
const ok = 200;
const secondPageOffset = pageSize * 2;
const thirdPageOffset = secondPageOffset + pageSize;
export const reply = (body: JsonObject): Promise<ProviderResponse> =>
  Promise.resolve({ status: ok, headers: {}, body });
export const failure = ({
  reason,
  status,
}: {
  reason: string;
  status: number;
}): Promise<ProviderResponse> =>
  Promise.resolve({ status, headers: {}, body: { error: { errors: [{ reason }] } } });
export function memberships({
  playlistId,
  count,
  start = 0,
}: {
  playlistId: string;
  count: number;
  start?: number;
}) {
  return [...Array(count).keys()].map((index) => item({ playlistId, index: start + index }));
}

export function youtubeFixture() {
  const listings = new Map<string, JsonObject[]>([
    ['a', memberships({ playlistId: 'a', count: archiveCount })],
    ['b', [item({ playlistId: 'b', index: 0 })]],
  ]);
  const requests: Array<{ path: string; query: JsonObject }> = [];
  let account = 'owner';
  let intercept:
    | ((input: { path: string; query: JsonObject }) => Promise<ProviderResponse> | undefined)
    | undefined;
  // Only the provider understands these opaque tokens. Production must pass them
  // back verbatim and never derive an offset, reverse cursor, or date from them.
  const pageTokens = new Map([
    ['opaque-fifty', pageSize],
    ['opaque-hundred', secondPageOffset],
    ['opaque-one-fifty', thirdPageOffset],
  ]);
  function readDirectory(query: JsonObject) {
    const ids = [...listings.keys()];
    const offset = query.pageToken
      ? ids.findIndex((id) => `directory-${id}` === query.pageToken)
      : 0;
    if (offset < 0) {
      return failure({ reason: 'invalidPageToken', status: badRequest });
    }
    return reply({
      items: ids[offset] ? [playlist(ids[offset]!)] : [],
      pageInfo: { totalResults: ids.length },
      ...(ids[offset + 1] ? { nextPageToken: `directory-${ids[offset + 1]}` } : {}),
    });
  }
  function readItems(query: JsonObject) {
    const entries = listings.get(String(query.playlistId));
    if (!entries) {
      return failure({ reason: 'playlistNotFound', status: notFound });
    }
    const offset = query.pageToken ? pageTokens.get(String(query.pageToken)) : 0;
    if (offset === undefined) {
      return failure({ reason: 'invalidPageToken', status: badRequest });
    }
    const page = entries.slice(offset, offset + pageSize);
    const next = [...pageTokens].find(([, value]) => value === offset + pageSize)?.[0];
    return reply({
      items: page,
      pageInfo: { totalResults: entries.length },
      ...(offset + pageSize < entries.length ? { nextPageToken: next! } : {}),
    });
  }
  const provider: ProviderOperations = {
    action: unused,
    post: unused,
    get({ path, query = {} }) {
      requests.push({ path, query });
      const injected = intercept?.({ path, query });
      if (injected) {
        return injected;
      }
      if (path.endsWith('/channels')) {
        return reply({ items: [{ id: account }] });
      }
      if (path.endsWith('/playlists')) {
        return readDirectory(query);
      }
      if (!path.endsWith('/playlistItems')) {
        return unused();
      }
      return readItems(query);
    },
  };
  return {
    listings,
    requests,
    provider,
    set account(value: string) {
      account = value;
    },
    set intercept(value: typeof intercept) {
      intercept = value;
    },
    get itemRequests() {
      return requests
        .filter((request) => request.path.endsWith('/playlistItems'))
        .map(({ query }) => [query.playlistId, query.pageToken ?? null]);
    },
  };
}
