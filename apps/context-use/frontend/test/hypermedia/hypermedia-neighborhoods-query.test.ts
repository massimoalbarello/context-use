import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import {
  type HypermediaNeighborhoods,
  hypermediaNeighborhoodsQueryOptions,
} from '../../src/queries/hypermedia';

test('one read-only request carries distinct anchor cursors and remains cached on repeat reads', async () => {
  const anchors = [
    { anchor: { readableId: 'alpha' }, cursor: 'alpha-next' },
    { anchor: { readableId: 'beta' } },
  ];
  const response: HypermediaNeighborhoods = {
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
    await client.fetchQuery(hypermediaNeighborhoodsQueryOptions(anchors));
    await client.fetchQuery(hypermediaNeighborhoodsQueryOptions(anchors));
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe('/api/hypermedia/neighborhoods');
    expect(requests[0]!.method).toBe('POST');
    expect(await requests[0]!.json()).toMatchObject({ anchors });
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});
