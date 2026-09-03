import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';
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

export const entitiesQueryOptions = infiniteQueryOptions({
  queryKey: entitiesListQueryKey,
  initialPageParam: 0,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.api.entities.get({ query: { offset: pageParam } });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  getNextPageParam: (page) => page.nextOffset ?? undefined,
});

export function entitySuggestionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...entitySuggestionsQueryKey, query],
    queryFn: async () => {
      const { data, error } = await api.api.entities.get({
        query: { limit: 7, offset: 0, query },
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
