import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { AssetParamsSchema } from '#routes/api/assets/model.ts';
import {
  AssetFacesSchema,
  assetFacesResponse,
  FaceAnnotationBodySchema,
  FaceParamsSchema,
} from '#routes/api/face-recognition/model.ts';
import type { AssetFacesServiceContract } from '#services/assets/faces.ts';

export function createAssetFacesController({
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
      '/assets/:assetReadableId/faces',
      async ({ params, user, status }) => {
        const result = await faces.detail({ ownerId: user.id, readableId: params.assetReadableId });
        return result
          ? assetFacesResponse(result)
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        params: AssetParamsSchema,
        response: { 200: AssetFacesSchema, 404: ErrorResponseSchema },
        detail: { tags: ['Assets'], summary: 'Read people and face annotations in an image' },
      },
    )
    .post(
      '/assets/:assetReadableId/faces/analyze',
      async ({ params, user, status }) => {
        const result = await faces.process({
          ownerId: user.id,
          readableId: params.assetReadableId,
        });
        return result
          ? assetFacesResponse(result)
          : status(StatusMap['Not Found'], { error: 'Asset not found' });
      },
      {
        params: AssetParamsSchema,
        response: { 200: AssetFacesSchema, 404: ErrorResponseSchema },
        detail: {
          tags: ['Assets'],
          summary: 'Analyze or retry an image without replacing its user annotations',
        },
      },
    )
    .put(
      '/assets/:assetReadableId/faces/:faceReadableId/annotation',
      async ({ params, body, user, status }) => {
        const updated = await faces.annotate({
          ownerId: user.id,
          readableId: params.assetReadableId,
          faceReadableId: params.faceReadableId,
          decision: body.decision,
          entityReadableId: body.decision === 'person' ? body.entityReadableId : undefined,
        });
        if (!updated) {
          return status(StatusMap['Not Found'], { error: 'Face or person not found' });
        }
        return assetFacesResponse(
          (await faces.detail({ ownerId: user.id, readableId: params.assetReadableId }))!,
        );
      },
      {
        params: FaceParamsSchema,
        body: FaceAnnotationBodySchema,
        response: { 200: AssetFacesSchema, 404: ErrorResponseSchema },
        detail: { tags: ['Assets'], summary: 'Confirm or correct a face identity' },
      },
    )
    .get(
      '/assets/:assetReadableId/faces/:faceReadableId/crop',
      async ({ params, user, status }) => {
        const crop = await faces.crop({
          ownerId: user.id,
          readableId: params.assetReadableId,
          faceReadableId: params.faceReadableId,
        });
        return crop
          ? new Response(crop, {
              headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            })
          : status(StatusMap['Not Found'], { error: 'Face not found' });
      },
      {
        params: FaceParamsSchema,
        detail: { tags: ['Assets'], summary: 'Read a private face crop' },
      },
    );
}
