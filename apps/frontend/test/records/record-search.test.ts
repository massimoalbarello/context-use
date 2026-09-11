import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { api } from '../../src/lib/api';
import { recordSuggestionsQueryOptions, recordsQueryOptions } from '../../src/queries/records';

type SearchResponse = NonNullable<
  Awaited<ReturnType<typeof api.api.hypermedia.search.get>>['data']
>;

test('records use the shared retrieval pipeline, preserve relevance order, and keep collection filter choices', async () => {
  const nextBrowseOffset = 30;
  const requests: URL[] = [];
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const response: SearchResponse = {
    results: ['second', 'first'].map((id) => ({
      resourceType: 'record',
      address: `context-use://record/${id}`,
      matchExcerpt: 'A matching body passage.',
      record: {
        readableId: id,
        recordId: id,
        title: `Notes ${id}`,
        provider: 'github',
        kind: 'issue',
        participantNames: ['Alex'],
        sync: { readableId: 'work', name: 'Work' },
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    })),
    totalMatches: 12,
    truncated: true,
  };
  const filterOptions = { providers: ['github', 'slack'], kinds: ['issue', 'message'] };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        return Promise.resolve(
          Response.json(
            url.pathname === '/api/hypermedia/search'
              ? response
              : url.pathname === '/api/records/filter-options'
                ? filterOptions
                : { items: [], nextOffset: nextBrowseOffset, filterOptions },
          ),
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const result = await client.fetchInfiniteQuery(
      recordsQueryOptions({
        query: 'discussion',
        provider: 'github',
        kind: 'issue',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
        updatedFrom: '2026-03-01T00:00:00.000Z',
        updatedTo: '2026-04-01T00:00:00.000Z',
        sortBy: 'sourceCreatedAt',
        sortDirection: 'asc',
      }),
    );
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/hypermedia/search',
      '/api/records/filter-options',
    ]);
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      query: 'discussion',
      resourceTypes: 'record',
      recordProvider: 'github',
      recordKind: 'issue',
      recordCreatedFrom: '2026-01-01T00:00:00.000Z',
      recordCreatedTo: '2026-02-01T00:00:00.000Z',
      recordUpdatedFrom: '2026-03-01T00:00:00.000Z',
      recordUpdatedTo: '2026-04-01T00:00:00.000Z',
    });
    expect(result.pages[0]?.items.map(({ readableId }) => readableId)).toEqual(['second', 'first']);
    expect(result.pages[0]?.filterOptions).toEqual(filterOptions);
    expect(result.pages[0]?.nextOffset).toBeNull();

    const browsing = await client.fetchInfiniteQuery(
      recordsQueryOptions({ query: '  ', provider: 'slack' }),
    );
    expect(requests.at(-1)?.pathname).toBe('/api/records');
    expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
      provider: 'slack',
      offset: '0',
    });
    expect(browsing.pages[0]?.nextOffset).toBe(nextBrowseOffset);

    const suggestions = await client.fetchQuery(recordSuggestionsQueryOptions('discussion'));
    expect(suggestions.map(({ readableId }) => readableId)).toEqual(['second', 'first']);
    expect(requests.at(-1)?.pathname).toBe('/api/hypermedia/search');
    expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
      query: 'discussion',
      resourceTypes: 'record',
      limit: '7',
    });
    await client.fetchQuery(recordSuggestionsQueryOptions(''));
    expect(requests.at(-1)?.pathname).toBe('/api/records');
    expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({ limit: '7', offset: '0' });
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
