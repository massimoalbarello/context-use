import type { FaceBox, FaceModel } from '#models/faces/model.ts';

export interface AnalyzedFace {
  box: FaceBox;
  detectionScore: number;
  embedding: number[];
  crop: Blob;
}

/** Execution locations implement this boundary; they do not own people or asset persistence. */
export interface FaceAnalyzer {
  readonly model: FaceModel;
  analyze(input: { ownerId: string; image: Blob; signal: AbortSignal }): Promise<AnalyzedFace[]>;
  close(): Promise<void>;
}

/** An actionable message safe to show alongside an already saved image. */
export class FaceAnalysisError extends Error {}
