/**
 * Open-vocabulary categorisation (web): CLIP zero-shot classification via
 * Transformers.js, run on the SAM-masked cutout (object pixels on white) so
 * the background cannot dilute the answer. Replaces the 80-class COCO label
 * lookup with true category understanding — buildings, artwork, portraits
 * and sculptures classify natively.
 */

import { Platform } from 'react-native';

import type { ObjectCategory } from './classify';
import type { Segmentation } from './segment';
import { loadTransformers } from './transformersRuntime';

const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';

/** CLIP prompt → product category. Order matters only for readability. */
const PROMPTS: Array<{ label: string; category: ObjectCategory }> = [
  { category: 'portrait', label: 'a portrait photo of a person' },
  { category: 'person', label: 'a full-body photo of a person' },
  { category: 'animal', label: 'an animal or a pet' },
  { category: 'vehicle', label: 'a car, truck, motorcycle or vehicle' },
  { category: 'building', label: 'a building, a house or architecture' },
  { category: 'art', label: 'artwork, a painting, a statue or a sculpture' },
  { category: 'tool', label: 'a tool, gadget or electronic device' },
  { category: 'food', label: 'food, a dish, a drink, or kitchenware like a mug or bowl' },
  { category: 'plant', label: 'a plant or flowers' },
  { category: 'object', label: 'an everyday household object' },
];

type Classifier = (image: string, labels: string[]) => Promise<Array<{ label: string; score: number }>>;

let classifierPromise: Promise<Classifier> | null = null;

async function getClassifier(): Promise<Classifier> {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const transformers = await loadTransformers();
      return (await transformers.pipeline('zero-shot-image-classification', CLIP_MODEL)) as Classifier;
    })();
    classifierPromise.catch(() => {
      classifierPromise = null;
    });
  }
  return classifierPromise;
}

/** Start the model download early (e.g. while the user is picking objects). */
export function preloadOpenVocab(): void {
  if (Platform.OS === 'web') {
    getClassifier().catch(() => undefined);
  }
}

/** Render the segmented object on a white canvas — background removed. */
async function maskedCutout(uri: string, segmentation: Segmentation): Promise<string | null> {
  const { region, mask, grid } = segmentation;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = uri;
  });

  const size = 336;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.drawImage(
    image,
    region.x * image.naturalWidth,
    region.y * image.naturalHeight,
    region.width * image.naturalWidth,
    region.height * image.naturalHeight,
    0,
    0,
    size,
    size,
  );

  // White-out everything outside the mask (block-level is fine for CLIP).
  const cell = size / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      if (!mask[gy * grid + gx]) {
        context.fillRect(gx * cell, gy * cell, cell + 1, cell + 1);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

export interface OpenVocabResult {
  category: ObjectCategory;
  confidence: number;
}

export async function classifyMaskedObject(
  uri: string,
  segmentation: Segmentation,
): Promise<OpenVocabResult | null> {
  if (Platform.OS !== 'web') {
    return null;
  }
  try {
    const [classifier, cutout] = await Promise.all([getClassifier(), maskedCutout(uri, segmentation)]);
    if (!cutout) return null;
    const results = await classifier(cutout, PROMPTS.map((prompt) => prompt.label));
    const top = results[0];
    if (!top) return null;
    const match = PROMPTS.find((prompt) => prompt.label === top.label);
    if (!match) return null;
    // eslint-disable-next-line no-console
    console.info('[openVocab]', top.label, top.score.toFixed(3));
    return { category: match.category, confidence: top.score };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[openVocab] failed:', (error as Error)?.message ?? error);
    return null;
  }
}
