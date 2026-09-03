import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import {
  type KnowledgePage,
  type KnowledgePagePreview,
  pagePreviewQueryOptions,
  pageQueryOptions,
} from '../../queries/pages';

export function usePage(readableId: string): UseQueryResult<KnowledgePage, Error> {
  return useQuery(pageQueryOptions(readableId));
}

export function usePagePreview(readableId: string): UseQueryResult<KnowledgePagePreview, Error> {
  return useQuery(pagePreviewQueryOptions(readableId));
}
