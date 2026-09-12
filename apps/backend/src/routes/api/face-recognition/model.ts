import { t } from 'elysia';
import type { AssetFaces, FaceSettings, FaceView } from '#models/faces/model.ts';
import { FACE_DECISIONS } from '#models/faces/model.ts';
import { EntityReferenceSchema, entityReferenceResponse } from '#routes/api/entities/model.ts';
import { ReadableIdSchema } from '#routes/api/model.ts';

export const FaceSchema = t.Object({
  readableId: ReadableIdSchema,
  box: t.Tuple([t.Number(), t.Number(), t.Number(), t.Number()]),
  decision: t.UnionEnum(FACE_DECISIONS),
  entity: t.Nullable(EntityReferenceSchema),
  similarity: t.Nullable(t.Number()),
  needsReview: t.Boolean(),
});
export const AssetFacesSchema = t.Object({
  state: t.UnionEnum(['not_processed', 'processing', 'ready', 'failed', 'unsupported']),
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
    name: t.String(),
    analysisVersion: t.String(),
    embeddingSpace: t.String(),
    dimensions: t.Integer(),
    metric: t.Literal('cosine'),
    defaultThreshold: t.Number(),
    supportedMediaTypes: t.Array(t.String()),
  }),
  threshold: t.Number(),
});
export const UpdateFaceSettingsSchema = t.Object({
  threshold: t.Number({ minimum: -1, maximum: 1 }),
  rematch: t.Boolean(),
  analysisVersion: t.String({ minLength: 1, maxLength: 256 }),
});
export const FaceRetryBodySchema = t.Object({ after: t.Nullable(ReadableIdSchema) });
export const FaceRetryResultSchema = t.Object({ next: t.Nullable(ReadableIdSchema) });

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
    model: { ...result.model, supportedMediaTypes: [...result.model.supportedMediaTypes] },
  };
}
