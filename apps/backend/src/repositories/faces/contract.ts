import type { AssetSummary } from '#models/assets/model.ts';
import type {
  AssetFaces,
  FaceAnnotation,
  FaceMatch,
  FaceModel,
  FaceObservation,
  FaceReference,
} from '#models/faces/model.ts';

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
  observations(input: FaceAssetInput): Promise<StoredFace[]>;
  begin(input: AnalysisAttempt): Promise<void>;
  complete(input: AnalysisAttempt & { faces: FaceObservation[] }): Promise<string[]>;
  fail(input: AnalysisAttempt & { error: string }): Promise<void>;
  references(input: { ownerId: string; embeddingSpace: string }): Promise<FaceReference[]>;
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
  saveMatches(
    input: FaceAssetInput & { matches: FaceMatch[]; threshold: number; embeddingSpace: string },
  ): Promise<void>;
  threshold(input: { ownerId: string; model: FaceModel }): Promise<number>;
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
