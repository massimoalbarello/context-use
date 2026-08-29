import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type KnowledgePage, pageQueryOptions } from '../../queries/pages';

export function usePage(readableId: string): UseQueryResult<KnowledgePage, Error> {
  return useQuery(pageQueryOptions(readableId));
}
