import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { EntityTypeFilter } from '#backend/models/entities/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';
import { searchHypermedia } from './hypermedia-search';
import type { KnowledgePageReference } from './pages';

export type EntityPage = NonNullable<Awaited<ReturnType<typeof api.api.entities.get>>['data']>;

export type EntitySummary = EntityPage['items'][number];

export type EntityDetail = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.entities>['get']>>['data']
>;

export type CreateEntityVariables = Omit<
  Parameters<typeof api.api.entities.post>[0],
  'changeMessage'
> & { changeMessage?: string };
export type UpdateEntityVariables = {
  readableId: string;
  body: Omit<Parameters<ReturnType<typeof api.api.entities>['patch']>[0], 'changeMessage'> & {
    changeMessage?: string;
  };
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

async function entitySearchPage({
  query,
  entityType,
  visibility,
  limit,
}: {
  query: string;
  entityType?: EntityTypeFilter;
  visibility?: PublicationVisibility;
  limit?: number;
}): Promise<EntityPage> {
  const result = await searchHypermedia({
    query,
    entityType,
    visibility,
    resourceTypes: 'entity',
    limit,
  });
  return {
    items: result.results.flatMap((hit) => (hit.resourceType === 'entity' ? [hit.entity] : [])),
    total: result.totalMatches,
    nextOffset: null,
  };
}

export function entitiesQueryOptions({
  query,
  entityType,
  visibility,
}: {
  query?: string;
  entityType?: EntityTypeFilter;
  visibility?: PublicationVisibility;
} = {}) {
  const normalizedQuery = query?.trim() || undefined;
  return infiniteQueryOptions({
    queryKey: [
      ...entitiesListQueryKey,
      {
        query: normalizedQuery ?? null,
        entityType: entityType ?? 'all',
        visibility: visibility ?? 'all',
      },
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (normalizedQuery) {
        return entitySearchPage({ query: normalizedQuery, entityType, visibility });
      }
      const { data, error } = await api.api.entities.get({
        query: { offset: pageParam, entityType, visibility },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
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
        .preview.get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function createEntity(body: CreateEntityVariables): Promise<{ readableId: string }> {
  const { data, error } = await api.api.entities.post({
    ...body,
    changeMessage: body.changeMessage?.trim() || `Added entity “${body.name}”`,
  });
  if (error) {
    if (error.status === ApiStatus.Conflict && 'nameConflict' in error.value) {
      throw new DuplicateResourceNameError(apiErrorMessage(error));
    }
    throw new Error(apiErrorMessage(error));
  }
  return { readableId: data.readableId };
}

export async function updateEntity({ readableId, body }: UpdateEntityVariables): Promise<void> {
  const { error } = await api.api.entities({ entityReadableId: readableId }).patch({
    ...body,
    changeMessage: body.changeMessage?.trim() || `Updated entity “${body.name}”`,
  });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function setEntityImage({
  readableId,
  assetReadableId,
}: SetEntityImageVariables): Promise<void> {
  const { error } = await api.api.entities({ entityReadableId: readableId }).image.put({
    changeMessage: 'Assigned an image to the entity',
    assetReadableId,
  });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function removeEntityImage({ readableId }: RemoveEntityImageVariables): Promise<void> {
  const { error } = await api.api
    .entities({ entityReadableId: readableId })
    .image.delete({ changeMessage: 'Removed the entity image' });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function archiveEntity({
  readableId,
}: ArchiveEntityVariables): Promise<ArchiveEntityResult> {
  const { error } = await api.api
    .entities({ entityReadableId: readableId })
    .archive.put({ changeMessage: 'Archived entity from the workspace' });
  if (error) {
    if (error.status === ApiStatus.Conflict && 'blockers' in error.value) {
      return { state: 'resource_in_use', blockers: error.value.blockers };
    }
    throw new Error(apiErrorMessage(error));
  }
  return { state: 'archived' };
}
