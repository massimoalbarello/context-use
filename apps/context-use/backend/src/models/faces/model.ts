import type { EntityReference } from '#backend/models/entities/model.ts';

export type FaceBox = readonly [number, number, number, number];
export const FACE_DECISIONS = ['automatic', 'person', 'unknown', 'dismissed'] as const;
export type FaceDecision = (typeof FACE_DECISIONS)[number];
export const MAX_FACES_PER_IMAGE = 100;

export interface FaceModel {
  readonly analysisVersion: string;
  readonly embeddingSpace: string;
  readonly dimensions: number;
  readonly name: string;
  readonly metric: 'cosine';
  readonly defaultThreshold: number;
  readonly supportedMediaTypes: readonly string[];
}

export interface FaceObservation {
  id: string;
  readableId: string;
  assetId: string;
  box: FaceBox;
  cropKey: string;
  detectionScore: number;
  analysisVersion: string;
  current: boolean;
  needsReview: boolean;
  embedding: number[];
  embeddingSpace: string;
  embeddingRevision: string;
}

export interface FaceView {
  readableId: string;
  box: FaceBox;
  decision: FaceDecision;
  entity: EntityReference | null;
  similarity: number | null;
  needsReview: boolean;
}

export interface AssetFaces {
  state: 'not_processed' | 'queued' | 'processing' | 'ready' | 'failed' | 'unsupported';
  error: string | null;
  outdated: boolean;
  faces: FaceView[];
}

export interface FaceSettings {
  model: Pick<FaceModel, 'analysisVersion' | 'defaultThreshold'>;
  threshold: number;
}

export interface FaceAnnotation {
  decision: Exclude<FaceDecision, 'automatic'>;
  entityId: string | null;
}

export interface FaceReference {
  entityId: string;
  faceId: string;
  assetId: string;
  embeddingSpace: string;
  embedding: number[];
  embeddingRevision: string;
}

export interface FaceMatch {
  faceId: string;
  referenceFaceId: string;
  faceEmbeddingRevision: string;
  referenceEmbeddingRevision: string;
  entityId: string;
  similarity: number;
}
