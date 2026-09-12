import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { EntityParamsSchema } from '#routes/api/entities/model.ts';
import { AssetFacesSchema, assetFacesResponse } from '#routes/api/face-recognition/model.ts';
import { ReadableIdSchema } from '#routes/api/model.ts';
import type { AssetFacesServiceContract } from '#services/assets/faces.ts';

const PortraitSchema = t.Object({
  image: t.Nullable(AssetSummarySchema),
  referenceFaceReadableId: t.Nullable(ReadableIdSchema),
  analysis: t.Nullable(AssetFacesSchema),
});

export function createEntityFacesController({
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
      '/entities/:entityReadableId/faces',
      async ({ params, user, status }) => {
        const result = await faces.portrait({
          ownerId: user.id,
          readableId: params.entityReadableId,
        });
        return result
          ? {
              image: result.image ? assetSummaryResponse(result.image) : null,
              referenceFaceReadableId: result.referenceFaceReadableId,
              analysis: result.analysis ? assetFacesResponse(result.analysis) : null,
            }
          : status(StatusMap['Not Found'], { error: 'Entity not found' });
      },
      {
        params: EntityParamsSchema,
        response: { 200: PortraitSchema, 404: ErrorResponseSchema },
        detail: { tags: ['Entities'], summary: 'Read a person’s recognition reference' },
      },
    )
    .put(
      '/entities/:entityReadableId/faces/reference',
      async ({ params, body, user, status }) => {
        const selected = await faces.selectReference({
          ownerId: user.id,
          readableId: params.entityReadableId,
          faceReadableId: body.faceReadableId,
        });
        return selected
          ? { selected: true }
          : status(StatusMap['Not Found'], { error: 'Person or reference face not found' });
      },
      {
        params: EntityParamsSchema,
        body: t.Object({ faceReadableId: ReadableIdSchema }),
        response: { 200: t.Object({ selected: t.Boolean() }), 404: ErrorResponseSchema },
        detail: {
          tags: ['Entities'],
          summary: 'Choose a face in the person’s portrait and match existing images',
        },
      },
    );
}
