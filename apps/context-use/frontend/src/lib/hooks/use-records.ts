import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  type RecordCollectionFilters,
  recordQueryOptions,
  recordsQueryOptions,
} from '../../queries/records';

export function useRecords(filters: RecordCollectionFilters = {}) {
  const result = useInfiniteQuery(recordsQueryOptions(filters));
  return {
    ...result,
    records: result.data?.pages.flatMap((page) => page.items) ?? [],
    filterOptions: result.data?.pages[0]?.filterOptions ?? { providers: [], kinds: [] },
  };
}

export function useRecord(readableId: string) {
  return useQuery(recordQueryOptions(readableId));
}
