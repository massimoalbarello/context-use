import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  DEFAULT_HYPERMEDIA_SEARCH_LIMIT,
  type HypermediaResourceType,
} from '#backend/models/hypermedia-retrieval/model.ts';
import {
  InvalidTemporalCoverageError,
  type TemporalBounds,
  temporalBoundsFrom,
} from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { invalidRecordDateRange } from '#backend/routes/api/records/model.ts';
import type { HypermediaRetrievalServiceContract } from '#backend/services/hypermedia-retrieval/service.ts';
import {
  HypermediaSearchQuerySchema,
  HypermediaSearchSchema,
  hypermediaSearchResultResponse,
} from './model.ts';

export function createHypermediaSearchController({
  auth,
  retrievalService,
}: {
  auth: Auth;
  retrievalService: Pick<HypermediaRetrievalServiceContract, 'search'>;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/hypermedia/search',
      async ({ query, user, status }) => {
        if (
          invalidRecordDateRange({ from: query.recordCreatedFrom, to: query.recordCreatedTo }) ||
          invalidRecordDateRange({ from: query.recordUpdatedFrom, to: query.recordUpdatedTo })
        ) {
          return status(StatusMap['Bad Request'], {
            error: 'The end of a source date range must be after its start.',
          });
        }
        let temporalBounds: TemporalBounds | undefined;
        try {
          temporalBounds = query.time ? temporalBoundsFrom(query.time) : undefined;
        } catch (error) {
          if (error instanceof InvalidTemporalCoverageError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
        const hasRecordFilter =
          query.recordProvider !== undefined ||
          query.recordKind !== undefined ||
          query.recordCreatedFrom !== undefined ||
          query.recordCreatedTo !== undefined ||
          query.recordUpdatedFrom !== undefined ||
          query.recordUpdatedTo !== undefined;
        const result = await retrievalService.search({
          ownerId: user.id,
          query: query.query,
          resourceTypes: query.resourceTypes?.split(',') as HypermediaResourceType[] | undefined,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_SEARCH_LIMIT,
          filters: {
            visibility: query.visibility,
            entity: { type: query.entityType },
            knowledgePage: { interval: query.interval, temporalBounds },
            asset: { kind: query.assetKind },
            record: hasRecordFilter
              ? {
                  provider: query.recordProvider?.trim(),
                  kind: query.recordKind?.trim(),
                  createdFrom: query.recordCreatedFrom?.toISOString(),
                  createdTo: query.recordCreatedTo?.toISOString(),
                  updatedFrom: query.recordUpdatedFrom?.toISOString(),
                  updatedTo: query.recordUpdatedTo?.toISOString(),
                }
              : undefined,
          },
        });
        return status(StatusMap.OK, {
          ...result,
          results: result.results.map(hypermediaSearchResultResponse),
        });
      },
      {
        detail: { tags: ['Hypermedia'], summary: 'Search typed hypermedia resources' },
        query: HypermediaSearchQuerySchema,
        response: {
          [StatusMap.OK]: HypermediaSearchSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
