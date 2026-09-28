import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { CalendarMonth } from '../../src/lib/calendar-month';
import {
  type MapPages,
  mapPagesQueryOptions,
  mapQueryKey,
  mergeMapPages,
} from '../../src/queries/map';

test('overlapping page batches render each canonical page once without restoring an older revision', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const page = {
    publishedAt: null,
    readableId: 'planning',
    revisionNumber: 1,
    title: 'Planning',
    excerpt: 'Plan',
    temporalCoverage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    entities: [{ readableId: 'owner' }],
  };
  const revised = { ...page, revisionNumber: 2, title: 'Revised planning' };
  const batch: MapPages = {
    pages: [page],
    nextOffset: null,
    entityReferencesTruncated: false,
  };
  expect(mergeMapPages([batch, { ...batch, pages: [revised] }, batch])).toEqual([revised]);
});

test('recent intervals reuse cached pages until invalidated or stale, with separate time and entity scopes', async () => {
  const requests: URL[] = [];
  const response: MapPages = {
    pages: [],
    nextOffset: null,
    entityReferencesTruncated: false,
  };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        requests.push(new URL(input instanceof Request ? input.url : input));
        return Promise.resolve(Response.json(response));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    const months: Array<CalendarMonth | undefined> = [undefined, '1970-01', '1969-12', undefined];
    for (const month of months) {
      await client.fetchInfiniteQuery(
        mapPagesQueryOptions({
          visibleEntities: [],
          month,
        }),
      );
    }

    expect(requests.map((url) => url.searchParams.get('time'))).toEqual([
      null,
      '1970-01',
      '1969-12',
    ]);
    expect(requests.every((url) => url.pathname === '/api/map/pages')).toBe(true);
    expect(requests.every((url) => !url.searchParams.has('entities'))).toBe(true);

    requests.length = 0;
    const focused = mapPagesQueryOptions({
      month: '1970-01',
      visibleEntities: [{ readableId: 'topic' }, { readableId: 'owner' }],
    });
    await client.fetchInfiniteQuery(focused);
    await client.fetchInfiniteQuery(
      mapPagesQueryOptions({
        month: '1970-01',
        visibleEntities: [{ readableId: 'owner' }, { readableId: 'topic' }],
      }),
    );
    expect(requests).toHaveLength(1);
    expect(requests.at(-1)?.searchParams.get('visible')).toBe('owner,topic');

    requests.length = 0;
    await client.invalidateQueries({ queryKey: mapQueryKey });
    await client.fetchInfiniteQuery(focused);
    expect(requests).toHaveLength(1);

    requests.length = 0;
    const twoMinutes = 120_000;
    client.setQueryData(focused.queryKey, (current) => current, {
      updatedAt: Date.now() - twoMinutes,
    });
    await client.fetchInfiniteQuery(focused);
    expect(requests).toHaveLength(1);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
