import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { type MapNeighborhoods, mapNeighborhoodsQueryOptions } from '../../src/queries/map';

test.each([
  { anchors: [{ anchor: { readableId: 'alpha' }, cursor: 'alpha-next' }] },
  {
    anchors: [
      { anchor: { readableId: 'alpha' }, cursor: 'alpha-next' },
      { anchor: { readableId: 'beta' } },
    ],
  },
])(
  'neighborhood GET preserves single and batched cursors and stays cached: %j',
  async ({ anchors }) => {
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
      const options = mapNeighborhoodsQueryOptions([...anchors]);
      await client.fetchQuery(options);
      await client.fetchQuery(options);
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]!.url).pathname).toBe('/api/map/neighborhoods');
      expect(requests[0]!.method).toBe('GET');
      expect(requests[0]!.body).toBeNull();
      expect(JSON.parse(new URL(requests[0]!.url).searchParams.get('anchors')!)).toEqual(anchors);
    } finally {
      client.clear();
      fetch.mockRestore();
    }
  },
);
