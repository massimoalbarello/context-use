import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/api-error';
import { applicationOrigin } from '../lib/application-origin';

const ANALYSIS_POLL_MS = 2000;

export const facesQueryKey = ['faces'] as const;
const settingsApi: (typeof api)['api']['face-recognition'] = api.api['face-recognition'];
const assetFacesApi = (readableId: string): ReturnType<typeof api.api.assets>['faces'] =>
  api.api.assets({ assetReadableId: readableId }).faces;
export type AssetFaces = NonNullable<
  Awaited<ReturnType<ReturnType<typeof assetFacesApi>['get']>>['data']
>;
export type Face = AssetFaces['faces'][number];
export type FaceSettings = NonNullable<
  Awaited<ReturnType<typeof settingsApi.settings.get>>['data']
>;
export type AnnotationInput = {
  assetReadableId: string;
  faceReadableId: string;
  body:
    | { decision: 'person'; entityReadableId: string }
    | { decision: 'automatic' | 'unknown' | 'dismissed' };
};
export type ThresholdInput = Parameters<typeof settingsApi.settings.put>[0];

export function faceCropUrl(input: { assetReadableId: string; faceReadableId: string }): string {
  return `${applicationOrigin()}/api/assets/${encodeURIComponent(input.assetReadableId)}/faces/${encodeURIComponent(input.faceReadableId)}/crop`;
}
export function assetFacesQueryOptions(readableId: string) {
  return queryOptions({
    queryKey: [...facesQueryKey, 'asset', readableId],
    refetchInterval: (query) =>
      query.state.data?.state === 'processing' ? ANALYSIS_POLL_MS : false,
    queryFn: async () => {
      const { data, error } = await assetFacesApi(readableId).get();
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
  });
}
export const faceSettingsQueryOptions = queryOptions({
  queryKey: [...facesQueryKey, 'settings'],
  queryFn: async () => {
    const { data, error } = await settingsApi.settings.get();
    if (error) {
      throw new Error(apiErrorMessage(error));
    }
    return data;
  },
});
export function personImagesQueryOptions(readableId: string) {
  return infiniteQueryOptions({
    queryKey: [...facesQueryKey, 'images', readableId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.api
        .entities({ entityReadableId: readableId })
        .images.get({ query: { offset: pageParam } });
      if (error) {
        throw new Error(apiErrorMessage(error));
      }
      return data;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
}
export async function analyzeAsset(readableId: string) {
  const { data, error } = await assetFacesApi(readableId).analyze.post();
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
export async function annotateFace(input: AnnotationInput) {
  const { data, error } = await assetFacesApi(input.assetReadableId)({
    faceReadableId: input.faceReadableId,
  }).annotation.put(input.body);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
export async function saveFaceThreshold(input: ThresholdInput) {
  const { data, error } = await settingsApi.settings.put(input);
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
export async function retryNextImage(after: string | null) {
  const { data, error } = await settingsApi.retry.post({ after });
  if (error) {
    throw new Error(apiErrorMessage(error));
  }
  return data;
}
