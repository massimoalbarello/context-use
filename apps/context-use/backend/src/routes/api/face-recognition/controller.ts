import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { assetSummaryResponse } from '#backend/routes/api/assets/summary-model.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import type { AssetFacesServiceContract } from '#backend/services/assets/faces.ts';
import {
  FaceActionAcceptedSchema,
  FaceProcessingSchema,
  FaceQueueQuerySchema,
  FaceSettingsSchema,
  faceSettingsResponse,
  UpdateFaceSettingsSchema,
} from './model.ts';

const DEFAULT_QUEUE_PAGE_SIZE = 20;

export function createFaceRecognitionController({
  auth,
  faces,
}: {
  auth: Auth;
  faces: AssetFacesServiceContract;
}) {
  return new Elysia()
    .use(changeMessagePlugin)
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
        changeMessage: true,
        body: UpdateFaceSettingsSchema,
        response: { 200: FaceSettingsSchema, 409: ErrorResponseSchema },
        detail: {
          tags: ['Assets'],
          summary: 'Save a matching threshold, optionally re-matching automatic assignments',
        },
      },
    )
    .get(
      '/face-recognition/processing',
      async ({ user, query }) => {
        const result = await faces.processing({
          ownerId: user.id,
          filter: query.filter ?? 'pending',
          offset: query.offset ?? 0,
          limit: query.limit ?? DEFAULT_QUEUE_PAGE_SIZE,
        });
        return {
          ...result,
          items: result.items.map((item) => ({ ...item, asset: assetSummaryResponse(item.asset) })),
        };
      },
      { query: FaceQueueQuerySchema, response: FaceProcessingSchema },
    )
    .post(
      '/face-recognition/retry',
      async ({ user }) => {
        await faces.retryFailed({ ownerId: user.id });
        return { accepted: true as const };
      },
      {
        changeMessage: true,
        response: FaceActionAcceptedSchema,
      },
    )
    .post(
      '/face-recognition/model/check',
      async () => {
        await faces.checkModel();
        return { accepted: true as const };
      },
      {
        changeMessage: true,
        response: FaceActionAcceptedSchema,
      },
    );
}
