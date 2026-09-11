import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';
import { searchHypermedia } from './hypermedia-search';
import type { KnowledgePageReference } from './pages';

export type EntityPage = NonNullable<Awaited<ReturnType<typeof api.api.entities.get>>['data']>;

export type EntitySummary = EntityPage['items'][number];

export type EntityDetail = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.entities>['get']>>['data']
>;

export type CreateEntityVariables = Parameters<typeof api.api.entities.post>[0];
export type UpdateEntityVariables = {
  readableId: string;
  body: Parameters<ReturnType<typeof api.api.entities>['patch']>[0];
};
export type ArchiveEntityVariables = { readableId: string };
export type SetEntityImageVariables = { readableId: string; assetReadableId: string };
export type RemoveEntityImageVariables = { readableId: string };
export type ArchiveEntityResult =
  | { state: 'archived' }
  | { state: 'resource_in_use'; blockers: KnowledgePageReference[] };

export const entitiesQueryKey = ['entities'] as const;
export const entitiesListQueryKey = [...entitiesQueryKey, 'list'] as const;
export const entityDetailsQueryKey = [...entitiesQueryKey, 'detail'] as const;
export const entityPreviewsQueryKey = [...entitiesQueryKey, 'preview'] as const;
export const entitySuggestionsQueryKey = [...entitiesQueryKey, 'suggestions'] as const;
const PREVIEW_RELATIONSHIP_LIMIT = 12;
const SUGGESTION_LIMIT = 7;

async function entitySearchPage({
  query,
  limit,
}: {
  query: string;
  limit?: number;
}): Promise<EntityPage> {
  const result = await searchHypermedia({ query, resourceTypes: 'entity', limit });
  return {
    items: result.results.flatMap((hit) => (hit.resourceType === 'entity' ? [hit.entity] : [])),
    total: result.totalMatches,
    nextOffset: null,
  };
}

export function entitiesQueryOptions(query?: string) {
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [...entitiesListQueryKey, { query: normalizedQuery ?? null }],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (normalizedQuery) {
        return entitySearchPage({ query: normalizedQuery });
      }
      const { data, error } = await api.api.entities.get({
        query: { offset: pageParam },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function entitySuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...entitySuggestionsQueryKey, query],
    queryFn: async () => {
      if (query.trim()) {
        return (await entitySearchPage({ query, limit: SUGGESTION_LIMIT })).items;
      }
      const { data, error } = await api.api.entities.get({
        query: { limit: SUGGESTION_LIMIT, offset: 0 },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data.items;
    },
  });
}

export function entityQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...entityDetailsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.entities({ entityReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export function entityPreviewQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...entityPreviewsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api
        .entities({ entityReadableId: readableId })
        .get({ query: { relationshipLimit: PREVIEW_RELATIONSHIP_LIMIT } });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function createEntity(body: CreateEntityVariables): Promise<{ readableId: string }> {
  const { data, error } = await api.api.entities.post(body);
  if (error) {
    if (error.status === ApiStatus.Conflict && 'nameConflict' in error.value) {
      throw new DuplicateResourceNameError(apiErrorMessage(error));
    }
    throw new Error(apiErrorMessage(error));
  }
  return { readableId: data.readableId };
}

export async function updateEntity({ readableId, body }: UpdateEntityVariables): Promise<void> {
  const { error } = await api.api.entities({ entityReadableId: readableId }).patch(body);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function setEntityImage({
  readableId,
  assetReadableId,
}: SetEntityImageVariables): Promise<void> {
  const { error } = await api.api
    .entities({ entityReadableId: readableId })
    .image.put({ assetReadableId });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function removeEntityImage({ readableId }: RemoveEntityImageVariables): Promise<void> {
  const { error } = await api.api.entities({ entityReadableId: readableId }).image.delete();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function archiveEntity({
  readableId,
}: ArchiveEntityVariables): Promise<ArchiveEntityResult> {
  const { error } = await api.api.entities({ entityReadableId: readableId }).archive.put();
  if (error) {
    if (error.status === ApiStatus.Conflict && 'blockers' in error.value) {
      return { state: 'resource_in_use', blockers: error.value.blockers };
    }
    throw new Error(apiErrorMessage(error));
  }
  return { state: 'archived' };
}
