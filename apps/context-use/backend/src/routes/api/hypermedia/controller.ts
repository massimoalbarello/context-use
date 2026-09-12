import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  type HypermediaAnchorRequest,
  InvalidHypermediaNeighborhoodsError,
} from '#backend/models/hypermedia-graph/model.ts';
import {
  InvalidTemporalCoverageError,
  type TemporalBounds,
  temporalBoundsFrom,
} from '#backend/models/knowledge-pages/temporal-coverage.ts';
import {
  DEFAULT_HYPERMEDIA_ENTITY_LIMIT,
  DEFAULT_HYPERMEDIA_PAGE_LIMIT,
  decodeHypermediaEntityCursor,
  HypermediaNeighborhoodsQuerySchema,
  HypermediaNeighborhoodsSchema,
  HypermediaPagesQuerySchema,
  HypermediaPagesSchema,
  hypermediaNeighborhoodsResponse,
  hypermediaPagesResponse,
  parseHypermediaEntities,
} from '#backend/routes/api/hypermedia/model.ts';
import type { HypermediaGraphServiceContract } from '#backend/services/hypermedia-graph/service.ts';

export function createHypermediaController({
  auth,
  graphService,
}: {
  auth: Auth;
  graphService: HypermediaGraphServiceContract;
}) {
  return new Elysia({ prefix: '/hypermedia' })
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: { [StatusMap.Unauthorized]: ErrorResponseSchema } })
    .post(
      '/neighborhoods',
      async ({ body, user, status }) => {
        const anchors: HypermediaAnchorRequest[] = [];
        for (const request of body.anchors) {
          const decoded = decodeHypermediaEntityCursor(request.cursor);
          if (decoded.state === 'invalid') {
            return status(StatusMap['Bad Request'], { error: 'Invalid neighborhood cursor' });
          }
          anchors.push({ anchor: request.anchor, cursor: decoded.cursor });
        }
        try {
          const result = await graphService.neighborhoods({
            ownerId: user.id,
            anchors,
            limit: body.limit ?? DEFAULT_HYPERMEDIA_ENTITY_LIMIT,
          });
          return status(StatusMap.OK, hypermediaNeighborhoodsResponse(result));
        } catch (error) {
          if (error instanceof InvalidHypermediaNeighborhoodsError) {
            return status(StatusMap['Bad Request'], { error: error.message });
          }
          throw error;
        }
      },
      {
        detail: {
          tags: ['Hypermedia'],
          summary: 'Read independently paginated entity neighborhoods',
          description:
            'Read-only batch expansion. Missing or archived anchors are unavailable. Relationships count distinct current active shared pages across all time; extra relationships between returned neighbors may be truncated.',
        },
        body: HypermediaNeighborhoodsQuerySchema,
        response: {
          [StatusMap.OK]: HypermediaNeighborhoodsSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages',
      async ({ query, user, status }) => {
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
        if (!visibleEntities) {
          return status(StatusMap['Bad Request'], { error: 'Invalid hypermedia pages query' });
        }
        const pages = await graphService.pages({
          ownerId: user.id,
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
