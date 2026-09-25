import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { api } from '../../src/lib/api';
import { assetsQueryOptions, imageAssetSuggestionsQueryOptions } from '../../src/queries/assets';
import { entitiesQueryOptions } from '../../src/queries/entities';
import { knowledgeSuggestionsQueryOptions } from '../../src/queries/knowledge-suggestions';
import { pagesQueryOptions } from '../../src/queries/pages';

type SearchResponse = NonNullable<
  Awaited<ReturnType<typeof api.api.hypermedia.search.get>>['data']
>;

test('sidebar and picker keyword queries use the shared search endpoint with typed filters', async () => {
  const requests: URL[] = [];
  const response: SearchResponse = { results: [], totalMatches: 0, truncated: false };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        requests.push(new URL(input instanceof Request ? input.url : input));
        return Promise.resolve(Response.json(response));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await client.fetchInfiniteQuery(entitiesQueryOptions({ query: 'running' }));
    await client.fetchInfiniteQuery(assetsQueryOptions({ query: 'running' }));
    await client.fetchInfiniteQuery(pagesQueryOptions({ query: 'running', interval: 'with' }));
    await client.fetchQuery(imageAssetSuggestionsQueryOptions({ query: 'running' }));
    await client.fetchQuery(knowledgeSuggestionsQueryOptions('running'));

    expect(requests.map((url) => url.pathname)).toEqual(
      Array.from({ length: 5 }, () => '/api/hypermedia/search'),
    );
    expect(requests.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { query: 'running', resourceTypes: 'entity' },
      { query: 'running', resourceTypes: 'asset' },
      { query: 'running', resourceTypes: 'knowledge_page', interval: 'with' },
      { query: 'running', resourceTypes: 'asset', limit: '7', assetKind: 'entity_image' },
      { query: 'running' },
    ]);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});

test('blank keyword queries browse typed collections without invoking retrieval', async () => {
  const requests: URL[] = [];
  const response: NonNullable<Awaited<ReturnType<typeof api.api.pages.get>>['data']> = {
    items: [],
    total: 0,
    nextOffset: null,
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await client.fetchInfiniteQuery(entitiesQueryOptions({ query: '  ' }));
    await client.fetchInfiniteQuery(assetsQueryOptions({ query: '  ' }));
    await client.fetchInfiniteQuery(pagesQueryOptions({ query: '  ' }));
    await client.fetchQuery(imageAssetSuggestionsQueryOptions({ query: '  ' }));

    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/entities',
      '/api/assets',
      '/api/pages',
      '/api/assets',
    ]);
    expect(requests.every((url) => !url.searchParams.has('query'))).toBe(true);
    expect(requests.at(-1)?.searchParams.get('kind')).toBe('entity_image');
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});

test('typed search callers preserve pipeline order and nonliteral matches without pagination', async () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const response: SearchResponse = {
    results: ['zoe', 'alice'].map((name) => ({
      resourceType: 'entity',
      address: `context-use://entity/${name}`,
      entity: {
        readableId: name,
        name,
        description: 'A colleague.',
        entityType: null,
        isSelf: false,
        image: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      matchExcerpt: null,
    })),
    totalMatches: 12,
    truncated: true,
  };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => Response.json(response), { preconnect: globalThis.fetch.preconnect }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const result = await client.fetchInfiniteQuery(
      entitiesQueryOptions({ query: 'collaborators' }),
    );
    expect(result.pages[0]?.items.map(({ readableId }) => readableId)).toEqual(['zoe', 'alice']);
    expect(result.pages[0]?.total).toBe(response.totalMatches);
    expect(result.pages[0]?.nextOffset).toBeNull();
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});

test('collection visibility separates cached list and keyword results with the existing filters', async () => {
  const requests: URL[] = [];
  const publicTotal = 2;
  const privateTotal = 7;
  const collectionCount = 3;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof globalThis.fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url);
        const total = url.searchParams.get('visibility') === 'public' ? publicTotal : privateTotal;
        return Promise.resolve(
          Response.json(
            url.pathname === '/api/hypermedia/search'
              ? { results: [], totalMatches: total, truncated: false }
              : { items: [], total, nextOffset: null },
          ),
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  try {
    for (const query of [undefined, 'launch']) {
      for (const visibility of ['public', 'private'] as const) {
        const results = await Promise.all([
          client.fetchInfiniteQuery(
            pagesQueryOptions({
              query,
              visibility,
              interval: 'with',
              dateRange: { from: '2026-01-01', to: '2026-01-31' },
            }),
          ),
          client.fetchInfiniteQuery(
            entitiesQueryOptions({ query, visibility, entityType: 'person' }),
          ),
          client.fetchInfiniteQuery(assetsQueryOptions({ query, visibility })),
        ]);
        expect(results.map((result) => result.pages[0]?.total)).toEqual(
          Array(collectionCount).fill(visibility === 'public' ? publicTotal : privateTotal),
        );
        const batch = requests.slice(-collectionCount);
        expect(batch.map((url) => url.pathname)).toEqual(
          query
            ? Array(collectionCount).fill('/api/hypermedia/search')
            : ['/api/pages', '/api/entities', '/api/assets'],
        );
        expect(batch.map((url) => url.searchParams.get('visibility'))).toEqual(
          Array(collectionCount).fill(visibility),
        );
        expect(batch[0]?.searchParams.get('interval')).toBe('with');
        expect(batch[0]?.searchParams.get('time')).toContain('2026-01-01');
        expect(batch[1]?.searchParams.get('entityType')).toBe('person');
      }
    }
    expect(requests).toHaveLength(collectionCount * 2 * 2);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
