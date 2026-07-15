/**
 * Object detection on the captured photo (web only): COCO-SSD via
 * TensorFlow.js. The model weights load lazily on first use so the app
 * bundle stays small. Native falls back to whole-photo selection.
 */

import { Platform } from 'react-native';

export interface DetectedObject {
  /** Fraction-of-image coordinates so overlays are resolution independent. */
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  score: number;
}

let modelPromise: Promise<unknown> | null = null;

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return modelPromise;
}

async function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = uri;
  });
}

export function isDetectionSupported() {
  return Platform.OS === 'web';
}

export async function detectObjects(uri: string): Promise<DetectedObject[]> {
  if (!isDetectionSupported()) {
    return [];
  }

  try {
    const [model, image] = await Promise.all([loadModel(), loadImage(uri)]);
    const predictions = await (
      model as { detect: (i: HTMLImageElement, n?: number) => Promise<Array<{ bbox: number[]; class: string; score: number }>> }
    ).detect(image, 8);

    return predictions
      .filter((prediction) => prediction.score > 0.4)
      .map((prediction) => ({
        height: prediction.bbox[3]! / image.naturalHeight,
        label: prediction.class,
        score: prediction.score,
        width: prediction.bbox[2]! / image.naturalWidth,
        x: prediction.bbox[0]! / image.naturalWidth,
        y: prediction.bbox[1]! / image.naturalHeight,
      }));
  } catch {
    return [];
  }
}
