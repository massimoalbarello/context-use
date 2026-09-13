import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  AssetSummarySchema,
  assetSummaryResponse,
} from '#backend/routes/api/assets/summary-model.ts';
import { EntityParamsSchema } from '#backend/routes/api/entities/model.ts';
import { PaginationQuerySchema } from '#backend/routes/api/model.ts';
import type { AssetFacesServiceContract } from '#backend/services/assets/faces.ts';

export function createEntityImagesController({
  auth,
  faces,
}: {
  auth: Auth;
  faces: AssetFacesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true })
    .get(
      '/entities/:entityReadableId/images',
      async ({ params, query, user, status }) => {
        const result = await faces.images({
          ownerId: user.id,
          entityReadableId: params.entityReadableId,
          offset: query.offset ?? 0,
          limit: query.limit,
        });
        return result
          ? { items: result.items.map(assetSummaryResponse), nextOffset: result.nextOffset }
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        params: EntityParamsSchema,
        query: PaginationQuerySchema,
        response: {
          200: t.Object({
            items: t.Array(AssetSummarySchema),
            nextOffset: t.Nullable(t.Integer()),
          }),
          404: ErrorResponseSchema,
        },
        detail: { tags: ['Entities'], summary: 'List images depicting a person' },
      },
    );
}
