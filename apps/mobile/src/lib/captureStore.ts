/**
 * Last-locked-capture persistence (web). The picker's blob: URI and the
 * in-memory segmentation die on reload, which made a direct #lab visit
 * arrive empty-handed. On every successful lock we store a compact data-URL
 * copy of the photo plus the serialized segmentation, so the lab (or any
 * future session on this device) can restore the capture with one tap.
 */

import type { Segmentation } from './photoEngine/segment';

const KEY = 'pixbrik.lastCapture.v1';
/** Longest edge of the stored photo copy — keeps us well under quota. */
const MAX_STORED_DIM = 900;
export const RAW_CAPTURE_TTL_MS = 24 * 60 * 60 * 1_000;

interface StoredCapture {
  at: string;
  photoDataUrl: string;
  segmentation: {
    aspectRatio?: number;
    backgroundMode?: Segmentation['backgroundMode'];
    backgroundRemovalProvider?: Segmentation['backgroundRemovalProvider'];
    grid: number;
    coverage: number;
    region: Segmentation['region'];
    mask: number[];
    colors: Array<[number, number, number] | null>;
    depth: number[] | null;
    face: Segmentation['face'];
    categoryLabel?: string;
    preserveFeatures?: boolean;
    maskSource?: Segmentation['maskSource'];
    isolationQuality?: Segmentation['isolationQuality'];
    isolationWarning?: string;
  };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // unavailable
  }
  return null;
}

function toStoredDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const scale = Math.min(1, MAX_STORED_DIM / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('no 2d context'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => reject(new Error('could not load photo'));
    image.src = src;
  });
}

/** Persist the capture after a successful lock. Best-effort, never throws. */
export async function saveLastCapture(photoUri: string, segmentation: Segmentation): Promise<void> {
  const store = storage();
  if (!store || typeof document === 'undefined') return;
  try {
    const photoDataUrl = await toStoredDataUrl(photoUri);
    const payload: StoredCapture = {
      at: new Date().toISOString(),
      photoDataUrl,
      segmentation: {
        aspectRatio: segmentation.aspectRatio,
        backgroundMode: segmentation.backgroundMode,
        backgroundRemovalProvider: segmentation.backgroundRemovalProvider,
        categoryLabel: segmentation.categoryLabel,
        colors: segmentation.colors,
        coverage: segmentation.coverage,
        depth: segmentation.depth ? Array.from(segmentation.depth) : null,
        face: segmentation.face ?? null,
        grid: segmentation.grid,
        isolationQuality: segmentation.isolationQuality,
        isolationWarning: segmentation.isolationWarning,
        mask: segmentation.mask.map((on) => (on ? 1 : 0)),
        maskSource: segmentation.maskSource,
        preserveFeatures: segmentation.preserveFeatures,
        region: segmentation.region,
      },
    };
    store.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Quota or decode failure — persistence is a convenience, not critical.
  }
}

export function hasLastCapture(): boolean {
  return loadLastCapture() !== null;
}

/** Delete the raw source photo and its derived segmentation from this browser. */
export function clearLastCapture(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** Rehydrate the stored capture, or null if none/corrupt. */
export function loadLastCapture(): { photoUri: string; segmentation: Segmentation } | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCapture;
    const savedAt = Date.parse(parsed.at);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > RAW_CAPTURE_TTL_MS) {
      clearLastCapture();
      return null;
    }
    const segmentation: Segmentation = {
      aspectRatio: parsed.segmentation.aspectRatio,
      backgroundMode: parsed.segmentation.backgroundMode,
      backgroundRemovalProvider: parsed.segmentation.backgroundRemovalProvider,
      categoryLabel: parsed.segmentation.categoryLabel,
      colors: parsed.segmentation.colors,
      coverage: parsed.segmentation.coverage,
      depth: parsed.segmentation.depth ? new Float32Array(parsed.segmentation.depth) : null,
      face: parsed.segmentation.face ?? null,
      grid: parsed.segmentation.grid,
      isolationQuality: parsed.segmentation.isolationQuality,
      isolationWarning: parsed.segmentation.isolationWarning,
      mask: parsed.segmentation.mask.map((bit) => bit === 1),
      maskSource: parsed.segmentation.maskSource,
      preserveFeatures: parsed.segmentation.preserveFeatures,
      region: parsed.segmentation.region,
    };
    return { photoUri: parsed.photoDataUrl, segmentation };
  } catch {
    clearLastCapture();
    return null;
  }
}
