import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type EntityDetail,
  entityPreviewQueryOptions,
  entityQueryOptions,
} from '../../queries/entities';

export function useEntity(readableId: string): UseQueryResult<EntityDetail, Error> {
  return useQuery(entityQueryOptions(readableId));
}

export function useEntityPreview(readableId: string): UseQueryResult<EntityDetail, Error> {
  return useQuery(entityPreviewQueryOptions(readableId));
}
