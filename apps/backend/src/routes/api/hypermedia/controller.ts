import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  type HypermediaAnchorRequest,
  InvalidHypermediaNeighborhoodsError,
} from '#models/hypermedia-graph/model.ts';
import {
  InvalidTemporalCoverageError,
  type TemporalBounds,
  temporalBoundsFrom,
} from '#models/knowledge-pages/temporal-coverage.ts';
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
} from '#routes/api/hypermedia/model.ts';
import type { HypermediaGraphServiceContract } from '#services/hypermedia-graph/service.ts';
import type { HypermediaRetrievalServiceContract } from '#services/hypermedia-retrieval/service.ts';

export function createHypermediaController({
  auth,
  graphService,
  retrievalService,
}: {
  auth: Auth;
  graphService: HypermediaGraphServiceContract;
  retrievalService: Pick<HypermediaRetrievalServiceContract, 'searchPageView'>;
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
        const input = {
          ownerId: user.id,
          entities,
          visibleEntities,
          limit: query.limit ?? DEFAULT_HYPERMEDIA_PAGE_LIMIT,
          offset: query.offset ?? 0,
          temporalBounds,
        };
        const pages = query.query?.trim()
          ? await retrievalService.searchPageView({ ...input, query: query.query })
          : await graphService.pages(input);
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
