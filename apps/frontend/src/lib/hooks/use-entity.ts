import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type EntityDetail, entityQueryOptions } from '../../queries/entities';

export function useEntity(readableId: string): UseQueryResult<EntityDetail, Error> {
  return useQuery(entityQueryOptions(readableId));
}
