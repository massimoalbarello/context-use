import type { AssetSummary } from '#backend/models/assets/model.ts';
import type {
  AssetFaces,
  FaceAnnotation,
  FaceModel,
  FaceObservation,
} from '#backend/models/faces/model.ts';
import type { FaceQueueFilter, FaceQueueItem } from '#backend/models/faces/processing.ts';

export type FaceAssetInput = { ownerId: string; assetId: string };
export type AnalysisAttempt = FaceAssetInput & {
  analysisVersion: string;
  contentHash: string;
  attemptId: string;
  updatedAt: string;
};
export type StoredFace = FaceObservation & { protected: boolean };

export interface FacesRepositoryContract {
  detail(input: FaceAssetInput & { analysisVersion: string }): Promise<
    Omit<AssetFaces, 'outdated' | 'state'> & {
      state: 'not_processed' | 'processing' | 'ready' | 'failed';
      analysisVersion: string | null;
    }
  >;
  nextPending(input: {
    analysisVersion: string;
    supportedMediaTypes: readonly string[];
  }): Promise<{ ownerId: string; readableId: string } | null>;
  queue(input: {
    ownerId: string;
    analysisVersion: string;
    supportedMediaTypes: readonly string[];
    filter: FaceQueueFilter;
    offset: number;
    limit: number;
  }): Promise<{
    items: FaceQueueItem[];
    counts: { queued: number; ready: number; failed: number; unsupported: number };
  }>;
  retryFailed(input: {
    ownerId: string;
    analysisVersion: string;
    updatedAt: string;
  }): Promise<void>;
  observations(input: FaceAssetInput): Promise<StoredFace[]>;
  enqueue(input: AnalysisAttempt): Promise<void>;
  begin(input: AnalysisAttempt): Promise<void>;
  complete(input: AnalysisAttempt & { faces: FaceObservation[] }): Promise<string[]>;
  fail(input: AnalysisAttempt & { error: string }): Promise<void>;
  enrollPortrait(
    input: FaceAssetInput & { entityId: string; analysisVersion: string; updatedAt: string },
  ): Promise<boolean>;
  referenceFace(input: { ownerId: string; entityId: string }): Promise<string | null>;
  annotate(
    input: FaceAssetInput & {
      faceReadableId: string;
      annotation: FaceAnnotation | null;
      updatedAt: string;
    },
  ): Promise<boolean>;
  matchAsset(
    input: FaceAssetInput & { model: Pick<FaceModel, 'embeddingSpace' | 'defaultThreshold'> },
  ): Promise<void>;
  threshold(input: {
    ownerId: string;
    model: Pick<FaceModel, 'embeddingSpace' | 'defaultThreshold'>;
  }): Promise<number>;
  setThreshold(input: {
    ownerId: string;
    embeddingSpace: string;
    threshold: number;
  }): Promise<void>;
  assetBatch(input: {
    ownerId: string;
    after: string | null;
    limit: number;
  }): Promise<Array<{ id: string; readableId: string; mediaType: string }>>;
  images(input: {
    ownerId: string;
    entityReadableId: string;
    offset: number;
    limit: number;
  }): Promise<AssetSummary[]>;
}
