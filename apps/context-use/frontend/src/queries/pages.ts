import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { KnowledgePageIntervalFilter } from '#backend/models/knowledge-pages/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { api } from '../lib/api';
import { ApiStatus, apiErrorMessage, DuplicateResourceNameError } from '../lib/api-error';
import { type CalendarDateRange, calendarDateRangeExpression } from '../lib/temporal-coverage';
import { searchHypermedia } from './hypermedia-search';

export type KnowledgePagePage = NonNullable<Awaited<ReturnType<typeof api.api.pages.get>>['data']>;

export type KnowledgePageSummary = KnowledgePagePage['items'][number];

export type KnowledgePageListFilters = {
  dateRange?: CalendarDateRange;
  query?: string;
  interval?: KnowledgePageIntervalFilter;
  visibility?: PublicationVisibility;
};

export type KnowledgePage = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['get']>>['data']
>;
export type KnowledgePagePreview = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['preview']['get']>>['data']
>;
export type KnowledgePageReference = KnowledgePage['references'][number];
export type KnowledgePageDiff = NonNullable<
  Awaited<ReturnType<ReturnType<typeof api.api.pages>['diff']['get']>>['data']
>;

export type CreatePageVariables = Omit<
  Parameters<typeof api.api.pages.post>[0],
  'changeMessage'
> & { changeMessage?: string };
export type UpdatePageVariables = {
  readableId: string;
  body: Omit<Parameters<ReturnType<typeof api.api.pages>['put']>[0], 'changeMessage'> & {
    changeMessage?: string;
  };
};
export type ArchivePageVariables = { readableId: string };
export type ArchivePageResult =
  | { state: 'archived' }
  | { state: 'resource_in_use'; blockers: KnowledgePageReference[] };

export const pagesQueryKey = ['pages'] as const;
export const pagesListQueryKey = [...pagesQueryKey, 'list'] as const;
export const pageDetailsQueryKey = [...pagesQueryKey, 'detail'] as const;
export const pagePreviewsQueryKey = [...pagesQueryKey, 'preview'] as const;
export const pageDiffsQueryKey = [...pagesQueryKey, 'diff'] as const;

export function pageDiffQueryOptions({
  readableId,
  from,
  to,
}: {
  readableId: string;
  from: number;
  to: number;
}) {
  return queryOptions({
    queryKey: [...pageDiffsQueryKey, readableId, { from, to }],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.api.pages({ pageReadableId: readableId }).diff.get({
        query: { from, to },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

async function pageSearchPage({
  query,
  limit,
  interval,
  time,
  visibility,
}: {
  query: string;
  limit?: number;
  interval?: KnowledgePageIntervalFilter;
  visibility?: PublicationVisibility;
  time?: string;
}): Promise<KnowledgePagePage> {
  const result = await searchHypermedia({
    query,
    resourceTypes: 'knowledge_page',
    limit,
    interval,
    time,
    visibility,
  });
  return {
    items: result.results.flatMap((hit) =>
      hit.resourceType === 'knowledge_page' ? [hit.knowledgePage] : [],
    ),
    total: result.totalMatches,
    nextOffset: null,
  };
}

export function pagesQueryOptions({
  dateRange,
  query,
  interval,
  visibility,
}: KnowledgePageListFilters = {}) {
  return infiniteQueryOptions({
    queryKey: [
      ...pagesListQueryKey,
      { dateRange: dateRange ?? null, query, interval, visibility: visibility ?? 'all' },
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const time = dateRange ? calendarDateRangeExpression(dateRange) : undefined;
      if (query?.trim()) {
        return pageSearchPage({ query, interval, time, visibility });
      }
      const { data, error } = await api.api.pages.get({
        query: { offset: pageParam, time, interval, visibility },
      });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}

export function pageQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...pageDetailsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.pages({ pageReadableId: readableId }).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export function pagePreviewQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...pagePreviewsQueryKey, readableId],
    queryFn: async () => {
      const { data, error } = await api.api.pages({ pageReadableId: readableId }).preview.get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}

export async function createPage(body: CreatePageVariables): Promise<{ readableId: string }> {
  const { data, error } = await api.api.pages.post({
    ...body,
    changeMessage: body.changeMessage?.trim() || `Added page`,
  });
  if (error) {
    if (error.status === ApiStatus.Conflict && 'nameConflict' in error.value) {
      throw new DuplicateResourceNameError(apiErrorMessage(error));
    }
    throw new Error(apiErrorMessage(error));
  }
  return { readableId: data.readableId };
}

export async function updatePage({ readableId, body }: UpdatePageVariables): Promise<void> {
  const { error } = await api.api
    .pages({ pageReadableId: readableId })
    .put({ ...body, changeMessage: body.changeMessage?.trim() || `Updated page` });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
}

export async function archivePage({
  readableId,
}: ArchivePageVariables): Promise<ArchivePageResult> {
  const { error } = await api.api
    .pages({ pageReadableId: readableId })
    .archive.put({ changeMessage: 'Archived page from the workspace' });
  if (error) {
    if (error.status === ApiStatus.Conflict && 'blockers' in error.value) {
      return { state: 'resource_in_use', blockers: error.value.blockers };
    }
    throw new Error(apiErrorMessage(error));
  }
  return { state: 'archived' };
}
