import type { FaceModel } from '#models/faces/model.ts';

const OPENCV_ZOO_REVISION = '47534e27c9851bb1128ccc0102f1145e27f23f98';
const MODEL_ROOT = `https://media.githubusercontent.com/media/opencv/opencv_zoo/${OPENCV_ZOO_REVISION}/models`;

export const FACE_MODEL_FILES = [
  {
    name: 'yunet.onnx',
    url: `${MODEL_ROOT}/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    maximumBytes: 300_000,
  },
  {
    name: 'sface-int8.onnx',
    url: `${MODEL_ROOT}/face_recognition_sface/face_recognition_sface_2021dec_int8.onnx`,
    sha256: '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a',
    maximumBytes: 10_000_000,
  },
] as const;

export const LOCAL_FACE_MODEL: FaceModel = {
  name: 'YuNet / SFace INT8',
  analysisVersion: 'opencv-4.10-yunet-2023mar-sface-2021dec-int8-oriented-v1',
  embeddingSpace: 'sface-2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a-align-v1',
  dimensions: 128,
  metric: 'cosine',
  defaultThreshold: 0.363,
  supportedMediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
};
