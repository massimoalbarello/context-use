import { t } from 'elysia';
import type { AssetFaces, FaceSettings, FaceView } from '#backend/models/faces/model.ts';
import { FACE_DECISIONS } from '#backend/models/faces/model.ts';
import {
  FACE_MODEL_STATES,
  FACE_PROCESSING_STATES,
  FACE_QUEUE_FILTERS,
} from '#backend/models/faces/processing.ts';
import { AssetSummarySchema } from '#backend/routes/api/assets/summary-model.ts';
import {
  EntityReferenceSchema,
  entityReferenceResponse,
} from '#backend/routes/api/entities/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';

export const FaceSchema = t.Object({
  readableId: ReadableIdSchema,
  box: t.Tuple([t.Number(), t.Number(), t.Number(), t.Number()]),
  decision: t.UnionEnum(FACE_DECISIONS),
  entity: t.Nullable(EntityReferenceSchema),
  similarity: t.Nullable(t.Number()),
  needsReview: t.Boolean(),
});
export const AssetFacesSchema = t.Object({
  state: t.UnionEnum(['not_processed', 'queued', 'processing', 'ready', 'failed', 'unsupported']),
  error: t.Nullable(t.String()),
  outdated: t.Boolean(),
  faces: t.Array(FaceSchema),
});
export const FaceParamsSchema = t.Object({
  assetReadableId: ReadableIdSchema,
  faceReadableId: ReadableIdSchema,
});
export const FaceAnnotationBodySchema = t.Union([
  t.Object({ decision: t.Literal('person'), entityReadableId: ReadableIdSchema }),
  t.Object({ decision: t.UnionEnum(['automatic', 'unknown', 'dismissed']) }),
]);
export const FaceSettingsSchema = t.Object({
  model: t.Object({
    analysisVersion: t.String(),
    defaultThreshold: t.Number(),
  }),
  threshold: t.Number(),
});
export const UpdateFaceSettingsSchema = t.Object({
  threshold: t.Number({ minimum: -1, maximum: 1 }),
  rematch: t.Boolean(),
  analysisVersion: t.String({ minLength: 1, maxLength: 256 }),
});
export const FaceQueueQuerySchema = t.Object({
  filter: t.Optional(t.UnionEnum(FACE_QUEUE_FILTERS)),
  offset: t.Optional(t.Integer({ minimum: 0 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
});
export const FaceProcessingSchema = t.Object({
  model: t.Object({
    name: t.String(),
    state: t.UnionEnum(FACE_MODEL_STATES),
    downloaded: t.Boolean(),
    error: t.Nullable(t.String()),
    checkedAt: t.Nullable(t.String()),
  }),
  counts: t.Object({
    queued: t.Integer(),
    ready: t.Integer(),
    failed: t.Integer(),
    unsupported: t.Integer(),
  }),
  items: t.Array(
    t.Object({
      asset: AssetSummarySchema,
      state: t.UnionEnum(FACE_PROCESSING_STATES),
      error: t.Nullable(t.String()),
    }),
  ),
  nextOffset: t.Nullable(t.Integer()),
});
export const FaceActionAcceptedSchema = t.Object({ accepted: t.Literal(true) });

export function faceResponse(face: FaceView) {
  return {
    readableId: face.readableId,
    box: [...face.box] as [number, number, number, number],
    decision: face.decision,
    entity: face.entity ? entityReferenceResponse(face.entity) : null,
    similarity: face.similarity,
    needsReview: face.needsReview,
  };
}
export function assetFacesResponse(result: AssetFaces) {
  return { ...result, faces: result.faces.map(faceResponse) };
}
export function faceSettingsResponse(result: FaceSettings) {
  return {
    threshold: result.threshold,
    model: {
      analysisVersion: result.model.analysisVersion,
      defaultThreshold: result.model.defaultThreshold,
    },
  };
}
