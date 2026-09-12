import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { CalendarMonth } from '../../src/lib/calendar-month';
import { type HypermediaPages, hypermediaPagesQueryOptions } from '../../src/queries/hypermedia';

test('scroll months select the API time and keep dated and undated results in separate caches', async () => {
  const requests: URL[] = [];
  const response: HypermediaPages = {
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
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  try {
    const months: Array<CalendarMonth | undefined> = [undefined, '1970-01', '1969-12', undefined];
    for (const month of months) {
      await client.fetchInfiniteQuery(
        hypermediaPagesQueryOptions({
          entities: [],
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
    expect(requests.every((url) => url.pathname === '/api/hypermedia/pages')).toBe(true);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
