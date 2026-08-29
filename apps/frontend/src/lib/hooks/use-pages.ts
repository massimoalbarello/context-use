import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type KnowledgePageSummary, pagesQueryOptions } from '../../queries/pages';

export function usePages(): UseQueryResult<KnowledgePageSummary[], Error> {
  return useQuery(pagesQueryOptions);
}
