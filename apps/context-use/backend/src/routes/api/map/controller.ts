import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  type HypermediaAnchorRequest,
  InvalidHypermediaNeighborhoodsError,
  InvalidHypermediaPagesError,
} from '#backend/models/hypermedia-graph/model.ts';
import {
  InvalidTemporalCoverageError,
  temporalBoundsFrom,
} from '#backend/models/knowledge-pages/temporal-coverage.ts';
import {
  DEFAULT_MAP_ENTITY_LIMIT,
  DEFAULT_MAP_PAGE_LIMIT,
  decodeMapEntityCursor,
  MapNeighborhoodsQuerySchema,
  MapNeighborhoodsSchema,
  MapPagesQuerySchema,
  MapPagesSchema,
  mapNeighborhoodsResponse,
  mapPagesResponse,
  parseMapEntities,
} from '#backend/routes/api/map/model.ts';
import type { HypermediaGraphServiceContract } from '#backend/services/hypermedia-graph/service.ts';

export function createMapController({
  auth,
  graphService,
}: {
  auth: Auth;
  graphService: HypermediaGraphServiceContract;
}) {
  return new Elysia({ prefix: '/map' })
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .get(
      '/neighborhoods',
      async ({ query, user, status }) => {
        const anchors: HypermediaAnchorRequest[] = [];
        for (const request of query.anchors) {
          const decoded = decodeMapEntityCursor(request.cursor);
          if (decoded.state === 'invalid') {
            return status(StatusMap['Bad Request'], { error: 'Invalid neighborhood cursor' });
          }
          anchors.push({ anchor: request.anchor, cursor: decoded.cursor });
        }
        try {
          const result = await graphService.neighborhoods({
            ownerId: user.id,
            anchors,
            limit: query.limit ?? DEFAULT_MAP_ENTITY_LIMIT,
          });
          return status(StatusMap.OK, mapNeighborhoodsResponse(result));
        } catch (error) {
          if (error instanceof InvalidHypermediaNeighborhoodsError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
      },
      {
        detail: {
          tags: ['Map'],
          summary: 'Read independently paginated entity neighborhoods',
          description:
            'Read-only batch expansion. Missing or archived anchors are unavailable. Relationships count distinct current active shared pages across all time; extra relationships between returned neighbors may be truncated.',
        },
        query: MapNeighborhoodsQuerySchema,
        response: {
          [StatusMap.OK]: MapNeighborhoodsSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages',
      async ({ query, user, status }) => {
        const visibleEntities = parseMapEntities(query.visible);
        if (!visibleEntities) {
          return status(StatusMap['Bad Request'], { error: 'Invalid map pages query' });
        }
        try {
          const pages = await graphService.pages({
            ownerId: user.id,
            visibleEntities,
            limit: query.limit ?? DEFAULT_MAP_PAGE_LIMIT,
            offset: query.offset ?? 0,
            temporalBounds: query.time ? temporalBoundsFrom(query.time) : undefined,
          });
          return status(StatusMap.OK, mapPagesResponse(pages));
        } catch (error) {
          if (
            error instanceof InvalidTemporalCoverageError ||
            error instanceof InvalidHypermediaPagesError
          ) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
      },
      {
        detail: { tags: ['Map'], summary: 'Read a bounded topic map page view' },
        query: MapPagesQuerySchema,
        response: {
          [StatusMap.OK]: MapPagesSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
