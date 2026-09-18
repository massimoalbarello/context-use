import { queryOptions } from '@tanstack/react-query';
import type { AssetSummary } from './assets';
import type { EntitySummary } from './entities';
import { searchHypermedia } from './hypermedia-search';
import type { KnowledgePageSummary } from './pages';
import type { ContextRecordSummary } from './records';

export const knowledgeSuggestionsQueryKey = ['knowledge-suggestions'] as const;

export type KnowledgeSuggestion =
  | { kind: 'entity'; entity: EntitySummary }
  | { kind: 'page'; page: KnowledgePageSummary }
  | { kind: 'asset'; asset: AssetSummary }
  | { kind: 'record'; record: ContextRecordSummary };

type KnowledgeSuggestions = {
  suggestions: KnowledgeSuggestion[];
  totalMatches: number;
  truncated: boolean;
};

export function knowledgeSuggestionsQueryOptions(query: string) {
  const normalizedQuery = query.trim();
  return queryOptions({
    queryKey: [...knowledgeSuggestionsQueryKey, normalizedQuery],
    enabled: normalizedQuery.length > 0,
    queryFn: async ({ signal }): Promise<KnowledgeSuggestions> => {
      const result = await searchHypermedia({ query: normalizedQuery, signal });
      return {
        suggestions: result.results.map((hit): KnowledgeSuggestion => {
          switch (hit.resourceType) {
            case 'entity':
              return { kind: 'entity', entity: hit.entity };
            case 'knowledge_page':
              return { kind: 'page', page: hit.knowledgePage };
            case 'asset':
              return { kind: 'asset', asset: hit.asset };
            default:
              return { kind: 'record', record: hit.record };
          }
        }),
        totalMatches: result.totalMatches,
        truncated: result.truncated,
      };
    },
  });
}
