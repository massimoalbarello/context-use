import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  InvalidTemporalCoverageError,
  type TemporalBounds,
  temporalBoundsFrom,
} from '#models/knowledge-pages/temporal-coverage.ts';
import {
  DEFAULT_HYPERMEDIA_PAGE_LIMIT,
  DEFAULT_HYPERMEDIA_RESOURCE_LIMIT,
  decodeHypermediaResourceCursor,
  HypermediaPagesQuerySchema,
  HypermediaPagesSchema,
  HypermediaResourceNeighborhoodQuerySchema,
  HypermediaResourceNeighborhoodSchema,
  hypermediaPagesResponse,
  hypermediaResourceNeighborhoodResponse,
  parseHypermediaResourceKinds,
  parseHypermediaResourceReference,
  parseHypermediaResources,
} from '#routes/api/hypermedia/model.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';
import type { HypermediaRetrievalServiceContract } from '#services/hypermedia-retrieval/service.ts';

export function createHypermediaController({
  auth,
  hypermediaService,
  retrievalService,
}: {
  auth: Auth;
  hypermediaService: HypermediaServiceContract;
  retrievalService: Pick<HypermediaRetrievalServiceContract, 'searchPageView'>;
}) {
  return new Elysia({ prefix: '/hypermedia' })
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/resources',
      async ({ query, user, status }) => {
        const anchor = parseHypermediaResourceReference(query.anchor);
        const kinds = parseHypermediaResourceKinds(query.kinds);
        const decodedCursor = decodeHypermediaResourceCursor(query.cursor);
        if (!anchor || !kinds || decodedCursor.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid resource neighborhood query' });
        }
        const neighborhood = await hypermediaService.resourceNeighborhood({
          ownerId: user.id,
          anchor,
          kinds,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_RESOURCE_LIMIT,
          cursor: decodedCursor.cursor,
        });
        return neighborhood
          ? status(StatusMap.OK, hypermediaResourceNeighborhoodResponse(neighborhood))
          : status(StatusMap['Not Found'], { error: 'Hypermedia resource not found' });
      },
      {
        detail: { tags: ['Hypermedia'], summary: 'Read a bounded resource neighborhood' },
        query: HypermediaResourceNeighborhoodQuerySchema,
        response: {
          [StatusMap.OK]: HypermediaResourceNeighborhoodSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages',
      async ({ query, user, status }) => {
        const resources = parseHypermediaResources(query.resources);
        const visibleResources = parseHypermediaResources(query.visible);
        const kinds = parseHypermediaResourceKinds(query.kinds);
        let temporalBounds: TemporalBounds | undefined;
        try {
          temporalBounds = query.time ? temporalBoundsFrom(query.time) : undefined;
        } catch (error) {
          if (error instanceof InvalidTemporalCoverageError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
        if (!resources || !visibleResources || !kinds) {
          return status(StatusMap['Bad Request'], { error: 'Invalid hypermedia pages query' });
        }
        const input = {
          ownerId: user.id,
          resources,
          visibleResources,
          kinds,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_PAGE_LIMIT,
          offset: query.offset ?? 0,
          temporalBounds,
        };
        const pages = query.query?.trim()
          ? await retrievalService.searchPageView({ ...input, query: query.query })
          : await hypermediaService.pages(input);
        return status(StatusMap.OK, hypermediaPagesResponse(pages));
      },
      {
        detail: { tags: ['Hypermedia'], summary: 'Read a bounded hypermedia page view' },
        query: HypermediaPagesQuerySchema,
        response: {
          [StatusMap.OK]: HypermediaPagesSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
