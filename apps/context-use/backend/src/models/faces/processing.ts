import type { AssetSummary } from '#backend/models/assets/model.ts';

export const FACE_QUEUE_FILTERS = ['pending', 'failed', 'ready', 'unsupported', 'all'] as const;
export type FaceQueueFilter = (typeof FACE_QUEUE_FILTERS)[number];
export const FACE_PROCESSING_STATES = [
  'queued',
  'processing',
  'ready',
  'failed',
  'unsupported',
] as const;
export type FaceProcessingState = (typeof FACE_PROCESSING_STATES)[number];
export const FACE_MODEL_STATES = [
  'not_downloaded',
  'unchecked',
  'checking',
  'ready',
  'unavailable',
] as const;
export interface FaceModelStatus {
  state: (typeof FACE_MODEL_STATES)[number];
  downloaded: boolean;
  error: string | null;
  checkedAt: string | null;
}
export interface FaceQueueItem {
  asset: AssetSummary;
  state: FaceProcessingState;
  error: string | null;
}
