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
  DEFAULT_HYPERMEDIA_ENTITY_LIMIT,
  DEFAULT_HYPERMEDIA_PAGE_LIMIT,
  decodeHypermediaEntityCursor,
  HypermediaEntityNeighborhoodQuerySchema,
  HypermediaEntityNeighborhoodSchema,
  HypermediaPagesQuerySchema,
  HypermediaPagesSchema,
  hypermediaEntityNeighborhoodResponse,
  hypermediaPagesResponse,
  parseHypermediaEntities,
  parseHypermediaEntityReference,
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
      '/entities',
      async ({ query, user, status }) => {
        const anchor = parseHypermediaEntityReference(query.anchor);
        const decodedCursor = decodeHypermediaEntityCursor(query.cursor);
        if (!anchor || decodedCursor.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid entity neighborhood query' });
        }
        const neighborhood = await hypermediaService.entityNeighborhood({
          ownerId: user.id,
          anchor,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_ENTITY_LIMIT,
          cursor: decodedCursor.cursor,
        });
        return neighborhood
          ? status(StatusMap.OK, hypermediaEntityNeighborhoodResponse(neighborhood))
          : status(StatusMap['Not Found'], { error: 'Hypermedia entity not found' });
      },
      {
        detail: { tags: ['Hypermedia'], summary: 'Read a bounded entity neighborhood' },
        query: HypermediaEntityNeighborhoodQuerySchema,
        response: {
          [StatusMap.OK]: HypermediaEntityNeighborhoodSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages',
      async ({ query, user, status }) => {
        const entities = parseHypermediaEntities(query.entities);
        const visibleEntities = parseHypermediaEntities(query.visible);
        let temporalBounds: TemporalBounds | undefined;
        try {
          temporalBounds = query.time ? temporalBoundsFrom(query.time) : undefined;
        } catch (error) {
          if (error instanceof InvalidTemporalCoverageError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
        if (!entities || !visibleEntities) {
          return status(StatusMap['Bad Request'], { error: 'Invalid hypermedia pages query' });
        }
        const pages = await hypermediaService.pages({
          ownerId: user.id,
          entities,
          visibleEntities,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_PAGE_LIMIT,
          offset: query.offset ?? 0,
          temporalBounds,
        });
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
