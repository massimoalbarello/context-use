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
  decodeHypermediaPageCursor,
  decodeHypermediaResourceCursor,
  FocusedHypermediaPagesQuerySchema,
  FocusedHypermediaPagesSchema,
  focusedHypermediaPagesResponse,
  HypermediaResourceNeighborhoodQuerySchema,
  HypermediaResourceNeighborhoodSchema,
  hypermediaResourceNeighborhoodResponse,
  parseHypermediaFocus,
  parseHypermediaResourceReference,
} from '#routes/api/hypermedia/model.ts';
import type { HypermediaServiceContract } from '#services/hypermedia/service.ts';

export function createHypermediaController({
  auth,
  hypermediaService,
}: {
  auth: Auth;
  hypermediaService: HypermediaServiceContract;
}) {
  return new Elysia({ prefix: '/hypermedia' })
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/resources',
      async ({ query, user, status }) => {
        const anchor = parseHypermediaResourceReference(query.anchor);
        const decodedCursor = decodeHypermediaResourceCursor(query.cursor);
        if (!anchor || decodedCursor.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid resource neighborhood query' });
        }
        const neighborhood = await hypermediaService.resourceNeighborhood({
          ownerId: user.id,
          anchor,
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
        const resources = parseHypermediaFocus(query.focus);
        const decodedCursor = decodeHypermediaPageCursor(query.cursor);
        let temporalBounds: TemporalBounds | undefined;
        try {
          temporalBounds = query.time ? temporalBoundsFrom(query.time) : undefined;
        } catch (error) {
          if (error instanceof InvalidTemporalCoverageError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
        if (!resources || decodedCursor.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid focused pages query' });
        }
        const pages = await hypermediaService.focusedPages({
          ownerId: user.id,
          resources,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_PAGE_LIMIT,
          cursor: decodedCursor.cursor,
          query: query.query,
          temporalBounds,
          retainPageReadableId: query.retainPage,
        });
        return status(StatusMap.OK, focusedHypermediaPagesResponse(pages));
      },
      {
        detail: { tags: ['Hypermedia'], summary: 'Read pages connected to focused resources' },
        query: FocusedHypermediaPagesQuerySchema,
        response: {
          [StatusMap.OK]: FocusedHypermediaPagesSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
