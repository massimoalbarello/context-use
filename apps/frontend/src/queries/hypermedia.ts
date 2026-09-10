import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type HypermediaResourceNeighborhood = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.resources)['get']>>['data']
>;
export type HypermediaResource = HypermediaResourceNeighborhood['anchor'];
export type HypermediaResourceReference =
  | { kind: 'entity'; readableId: string }
  | { kind: 'asset'; readableId: string };
export type HypermediaResourceKind = HypermediaResourceReference['kind'];
export type HypermediaPages = NonNullable<
  Awaited<ReturnType<(typeof api.api.hypermedia.pages)['get']>>['data']
>;
export type HypermediaPage = HypermediaPages['pages'][number];
export type HypermediaEntity = Extract<HypermediaResource, { kind: 'entity' }>['entity'];
export type HypermediaAsset = Extract<HypermediaResource, { kind: 'asset' }>['asset'];
type HypermediaPagesRequest = NonNullable<Parameters<(typeof api.api.hypermedia.pages)['get']>[0]>;
export type HypermediaPageLayer = NonNullable<
  NonNullable<HypermediaPagesRequest['query']>['layer']
>;
export type HypermediaView = 'map' | 'timeline';

export const hypermediaQueryKey = ['hypermedia'] as const;
export const HYPERMEDIA_NEIGHBORHOOD_SIZE = 16;

export function hypermediaResourceKey(resource: HypermediaResourceReference): string {
  return `${resource.kind}:${resource.readableId}`;
}

export function hypermediaResourceReference(
  resource: HypermediaResource,
): HypermediaResourceReference {
  return resource.kind === 'entity'
    ? { kind: 'entity', readableId: resource.entity.readableId }
    : { kind: 'asset', readableId: resource.asset.readableId };
}

export function hypermediaResourceNeighborhoodQueryOptions({
  anchor,
  kinds,
  cursor,
}: {
  anchor: HypermediaResourceReference;
  kinds: HypermediaResourceKind[];
  cursor?: string;
}) {
  const anchorKey = hypermediaResourceKey(anchor);
  const resourceKinds = [...kinds].sort();
  return queryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'resources',
      anchorKey,
      { kinds: resourceKinds, cursor: cursor ?? null },
    ] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.api.hypermedia.resources.get({
        query: {
          anchor: anchorKey,
          kinds: resourceKinds.join(','),
          cursor,
          limit: HYPERMEDIA_NEIGHBORHOOD_SIZE,
        },
        fetch: { signal },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export type HypermediaPageQuery = {
  layer: HypermediaPageLayer;
  resources: HypermediaResourceReference[];
  visibleResources: HypermediaResourceReference[];
  kinds: HypermediaResourceKind[];
  month?: string;
  query?: string;
};

export const HYPERMEDIA_PAGE_LIMIT = 32;

export function hypermediaPagesQueryOptions({
  layer,
  resources,
  visibleResources,
  kinds,
  month,
  query,
}: HypermediaPageQuery) {
  const resourceKeys = resources.map(hypermediaResourceKey).sort();
  const visibleResourceKeys = visibleResources.map(hypermediaResourceKey).sort();
  const resourceKinds = [...kinds].sort();
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [
      ...hypermediaQueryKey,
      'pages',
      {
        layer,
        resources: resourceKeys,
        visibleResources: visibleResourceKeys,
        kinds: resourceKinds,
        month: month ?? null,
        query: normalizedQuery ?? null,
      },
    ] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api.api.hypermedia.pages.get({
        query: {
          layer,
          resources: resourceKeys.length > 0 ? resourceKeys.join(',') : undefined,
          visible: visibleResourceKeys.length > 0 ? visibleResourceKeys.join(',') : undefined,
          kinds: resourceKinds.join(','),
          limit: HYPERMEDIA_PAGE_LIMIT,
          offset: pageParam,
          time: month,
          query: normalizedQuery,
        },
        fetch: { signal },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}
