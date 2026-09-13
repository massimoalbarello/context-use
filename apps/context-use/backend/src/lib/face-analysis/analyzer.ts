import { z } from 'zod';
import { type FaceModel, MAX_FACES_PER_IMAGE } from '#backend/models/faces/model.ts';

export const MAX_FACE_CROP_BYTES = 262_144;
const BOX_EDGE_TOLERANCE = 1.000001;
export const AnalyzedFaceSchema = z.object({
  // Coordinates are normalized against the original image after applying its orientation.
  box: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().positive().max(1),
      z.number().positive().max(1),
    ])
    .refine(
      ([x, y, width, height]) =>
        x + width <= BOX_EDGE_TOLERANCE && y + height <= BOX_EDGE_TOLERANCE,
    )
    .readonly(),
  detectionScore: z.number().min(0).max(1),
  embedding: z
    .array(
      z
        .number()
        .finite()
        .refine((value) => Number.isFinite(Math.fround(value))),
    )
    .refine((vector) => vector.some((value) => Math.fround(value) !== 0)),
  // Adapters normalize crops to JPEG; storage and HTTP do not depend on their native format.
  crop: z
    .instanceof(Blob)
    .refine(
      (crop) => crop.type === 'image/jpeg' && crop.size > 0 && crop.size <= MAX_FACE_CROP_BYTES,
    ),
});
export type AnalyzedFace = z.infer<typeof AnalyzedFaceSchema>;

const FaceAnalysisSchema = z.object({
  model: z.object({ analysisVersion: z.string(), embeddingSpace: z.string() }).readonly(),
  faces: z.array(AnalyzedFaceSchema).max(MAX_FACES_PER_IMAGE),
});
export type FaceAnalysis = z.infer<typeof FaceAnalysisSchema>;

/** Execution locations implement this boundary; they do not own people or asset persistence. */
export interface FaceAnalyzer {
  /** Fixed for this analyzer's lifetime. Replace the analyzer to change models. */
  readonly model: FaceModel;
  /** Image bytes carry their verified media type; storage paths never cross this boundary. */
  analyze(input: { ownerId: string; image: Blob; signal: AbortSignal }): Promise<FaceAnalysis>;
}

/** An actionable message safe to show alongside an already saved image. */
export class FaceAnalysisError extends Error {}

/** Check every execution adapter's output before it becomes durable observations or links. */
export function validateFaceAnalysis({
  result,
  model,
}: {
  result: FaceAnalysis;
  model: FaceModel;
}): AnalyzedFace[] {
  const parsed = FaceAnalysisSchema.safeParse(result);
  if (
    !parsed.success ||
    parsed.data.model.analysisVersion !== model.analysisVersion ||
    parsed.data.model.embeddingSpace !== model.embeddingSpace ||
    parsed.data.faces.some((face) => face.embedding.length !== model.dimensions)
  ) {
    throw new FaceAnalysisError(
      'Face analyzer returned incompatible or invalid results. Retry this image.',
    );
  }
  return parsed.data.faces;
}
