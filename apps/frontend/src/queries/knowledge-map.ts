import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';

export type KnowledgeMap = NonNullable<
  Awaited<ReturnType<(typeof api.api)['knowledge-map']['get']>>['data']
>;
export type KnowledgeMapPage = KnowledgeMap['pages'][number];
export type KnowledgeMapEntity = KnowledgeMapPage['mentions'][number];
export type KnowledgeMapAsset = KnowledgeMapPage['assetUsages'][number]['asset'];

export const knowledgeMapQueryKey = ['knowledge-map'] as const;

export const knowledgeMapQueryOptions = queryOptions({
  queryKey: knowledgeMapQueryKey,
  queryFn: async () => {
    const { data, error } = await api.api['knowledge-map'].get({ query: { limit: 40 } });
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});
