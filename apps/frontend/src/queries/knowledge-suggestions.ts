import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import type { AssetSummary } from './assets';
import type { EntitySummary } from './entities';
import { hypermediaQueryKey } from './hypermedia';
import { searchHypermedia } from './hypermedia-search';
import type { KnowledgePageSummary } from './pages';
import type { ExternalRecordSummary } from './records';

export type KnowledgeSuggestion =
  | { kind: 'entity'; entity: EntitySummary }
  | { kind: 'page'; page: KnowledgePageSummary }
  | { kind: 'asset'; asset: AssetSummary }
  | { kind: 'record'; record: ExternalRecordSummary };

type KnowledgeSuggestions = {
  suggestions: KnowledgeSuggestion[];
  totalMatches: number | null;
  truncated: boolean;
};

const INITIAL_SUGGESTIONS_PER_TYPE = 7;

export function knowledgeSuggestionsQueryOptions(query: string) {
  const normalizedQuery = query.trim();
  return queryOptions({
    queryKey: [...hypermediaQueryKey, 'suggestions', normalizedQuery],
    queryFn: async ({ signal }): Promise<KnowledgeSuggestions> => {
      if (normalizedQuery) {
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
      }

      const options = {
        query: { limit: INITIAL_SUGGESTIONS_PER_TYPE, offset: 0 },
        fetch: { signal },
      };
      const [entities, pages, assets, records] = await Promise.all([
        api.api.entities.get(options),
        api.api.pages.get(options),
        api.api.assets.get(options),
        api.api.records.get(options),
      ]);
      if (entities.error) {
        throw new Error(apiErrorMessage(entities.error));
      }
      if (pages.error) {
        throw new Error(apiErrorMessage(pages.error));
      }
      if (assets.error) {
        throw new Error(apiErrorMessage(assets.error));
      }
      if (records.error) {
        throw new Error(apiErrorMessage(records.error));
      }
      return {
        suggestions: [
          ...entities.data.items.map((entity) => ({ kind: 'entity' as const, entity })),
          ...pages.data.items.map((page) => ({ kind: 'page' as const, page })),
          ...assets.data.items.map((asset) => ({ kind: 'asset' as const, asset })),
          ...records.data.items.map((record) => ({ kind: 'record' as const, record })),
        ],
        totalMatches: null,
        truncated: false,
      };
    },
  });
}
