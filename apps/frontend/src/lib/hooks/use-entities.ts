import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type EntitySummary, entitiesQueryOptions } from '../../queries/entities';

export function useEntities(): UseQueryResult<EntitySummary[], Error> {
  return useQuery(entitiesQueryOptions);
}
