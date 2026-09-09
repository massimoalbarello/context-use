import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { recordQueryOptions, recordsQueryOptions } from '../../queries/records';

export function useRecords() {
  const result = useInfiniteQuery(recordsQueryOptions());
  return {
    ...result,
    records: result.data?.pages.flatMap((page) => page.items) ?? [],
  };
}

export function useRecord(readableId: string) {
  return useQuery(recordQueryOptions(readableId));
}
