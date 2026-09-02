import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type KnowledgeMapBatch = NonNullable<
  Awaited<ReturnType<(typeof api.api)['knowledge-map']['get']>>['data']
>;
export type KnowledgeMapPage = KnowledgeMapBatch['pages'][number];
export type KnowledgeMapEntity = KnowledgeMapPage['mentions'][number];
export type KnowledgeMapAsset = KnowledgeMapPage['assetUsages'][number]['asset'];
export type KnowledgeMap = {
  pages: KnowledgeMapPage[];
  totalPages: number;
  truncated: boolean;
};

export const knowledgeMapQueryKey = ['knowledge-map'] as const;
export const KNOWLEDGE_MAP_BATCH_SIZE = 8;

export const knowledgeMapQueryOptions = infiniteQueryOptions({
  queryKey: knowledgeMapQueryKey,
  initialPageParam: undefined as string | undefined,
  staleTime: Number.POSITIVE_INFINITY,
  queryFn: async ({ pageParam }) => {
    const { data, error } = await api.api['knowledge-map'].get({
      query: { cursor: pageParam, limit: KNOWLEDGE_MAP_BATCH_SIZE },
    });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
  getNextPageParam: (batch) => batch.nextCursor ?? undefined,
});

export function knowledgeMapFrom(batches: KnowledgeMapBatch[]): KnowledgeMap {
  const seenPages = new Set<string>();
  return {
    pages: batches.flatMap((batch) =>
      batch.pages.filter((page) => {
        if (seenPages.has(page.readableId)) {
          return false;
        }
        seenPages.add(page.readableId);
        return true;
      }),
    ),
    totalPages: batches[0]?.totalPages ?? 0,
    truncated: batches.some((batch) => batch.truncated),
  };
}
