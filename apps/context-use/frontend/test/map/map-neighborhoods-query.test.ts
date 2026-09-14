import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { type MapNeighborhoods, mapNeighborhoodsQueryOptions } from '../../src/queries/map';

test('one read-only request carries distinct anchor cursors and remains cached on repeat reads', async () => {
  const anchors = [
    { anchor: { readableId: 'alpha' }, cursor: 'alpha-next' },
    { anchor: { readableId: 'beta' } },
  ];
  const response: MapNeighborhoods = {
    entities: [],
    neighborhoods: [],
    relationships: [],
    relationshipsTruncated: false,
  };
  const requests: Request[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (...args: Parameters<typeof globalThis.fetch>) => {
        requests.push(new Request(...args));
        return Promise.resolve(Response.json(response));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await client.fetchQuery(mapNeighborhoodsQueryOptions(anchors));
    await client.fetchQuery(mapNeighborhoodsQueryOptions(anchors));
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe('/api/map/neighborhoods');
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.body).toBeNull();
    expect(JSON.parse(new URL(requests[0]!.url).searchParams.get('anchors')!)).toEqual(anchors);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
