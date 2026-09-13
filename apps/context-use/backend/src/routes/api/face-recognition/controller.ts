import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import {
  type AssetFacesServiceContract,
  FaceProcessingBusyError,
} from '#backend/services/assets/faces.ts';
import {
  FaceRetryBodySchema,
  FaceRetryResultSchema,
  FaceSettingsSchema,
  faceSettingsResponse,
  UpdateFaceSettingsSchema,
} from './model.ts';

export function createFaceRecognitionController({
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
      '/face-recognition/settings',
      async ({ user }) => faceSettingsResponse(await faces.settings({ ownerId: user.id })),
      {
        response: FaceSettingsSchema,
        detail: { tags: ['Assets'], summary: 'Read local face recognition settings' },
      },
    )
    .put(
      '/face-recognition/settings',
      async ({ user, body, status }) => {
        const current = await faces.settings({ ownerId: user.id });
        if (current.model.analysisVersion !== body.analysisVersion) {
          return status(StatusMap.Conflict, {
            error: 'The face model changed. Refresh settings before saving.',
          });
        }
        await faces.saveThreshold({
          ownerId: user.id,
          threshold: body.threshold,
          rematch: body.rematch,
        });
        return faceSettingsResponse(await faces.settings({ ownerId: user.id }));
      },
      {
        body: UpdateFaceSettingsSchema,
        response: { 200: FaceSettingsSchema, 409: ErrorResponseSchema },
        detail: {
          tags: ['Assets'],
          summary: 'Save a matching threshold, optionally re-matching automatic assignments',
        },
      },
    )
    .post(
      '/face-recognition/retry',
      async ({ user, body, status }) => {
        try {
          return await faces.retryBatch({ ownerId: user.id, after: body.after });
        } catch (error) {
          if (error instanceof FaceProcessingBusyError) {
            return status(StatusMap.Conflict, { error: error.message });
          }
          throw error;
        }
      },
      {
        body: FaceRetryBodySchema,
        response: { 200: FaceRetryResultSchema, 409: ErrorResponseSchema },
        detail: {
          tags: ['Assets'],
          summary: 'Retry the next failed or unprocessed image in a resumable scan',
        },
      },
    );
}
