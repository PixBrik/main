import {
  SEGMENT_GRID,
  type Segmentation,
  type SegmentationRegion,
} from './segment';

const REMOVE_ENDPOINT = '/api/background/remove';
const MAX_CROP_EDGE = 1024;
const CLIENT_TIMEOUT_MS = 15_000;
const MAX_CACHED_CUTOUTS = 4;
/** Preserve thin features after area-averaging alpha into a brick cell. */
export const SMART_MASK_ALPHA_THRESHOLD = 0.22;

type Provider = NonNullable<Segmentation['backgroundRemovalProvider']>;

interface RasterizedCrop {
  aspectRatio: number;
  canvas: HTMLCanvasElement;
  colors: Array<[number, number, number] | null>;
  height: number;
  width: number;
}

interface CachedCutout {
  cutoutUri: string;
  mask: boolean[];
  provider?: Provider;
}

const cutoutCache = new Map<string, Promise<CachedCutout>>();

export class BackgroundRemovalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BackgroundRemovalError';
  }
}

export function isBackgroundRemovalEnabled(): boolean {
  return (process.env.EXPO_PUBLIC_BACKGROUND_REMOVAL_ENABLED ?? '') === '1';
}

function loadBrowserImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new BackgroundRemovalError('Smart isolate is available in the web app only.'));
      return;
    }
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new BackgroundRemovalError('The framed photo could not be read.'));
    image.src = uri;
  });
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new BackgroundRemovalError('This browser cannot process the framed photo.');
  return context;
}

function sampleColors(
  source: HTMLCanvasElement,
  grid: number,
): Array<[number, number, number] | null> {
  const canvas = document.createElement('canvas');
  canvas.width = grid;
  canvas.height = grid;
  const context = canvasContext(canvas);
  context.drawImage(source, 0, 0, grid, grid);
  const pixels = context.getImageData(0, 0, grid, grid).data;
  const colors: Array<[number, number, number] | null> = new Array(grid * grid);
  for (let cell = 0; cell < colors.length; cell++) {
    colors[cell] = [pixels[cell * 4]!, pixels[cell * 4 + 1]!, pixels[cell * 4 + 2]!];
  }
  return colors;
}

/**
 * Render the exact normalized frame to a new canvas. Re-encoding that canvas
 * as PNG strips camera EXIF and guarantees the provider sees only the crop.
 */
async function rasterizeFramedCrop(
  uri: string,
  region: SegmentationRegion,
  grid: number,
): Promise<RasterizedCrop> {
  const image = await loadBrowserImage(uri);
  const x = Math.max(0, Math.min(1, region.x));
  const y = Math.max(0, Math.min(1, region.y));
  const widthFraction = Math.max(0, Math.min(region.width, 1 - x));
  const heightFraction = Math.max(0, Math.min(region.height, 1 - y));
  const sourceWidth = widthFraction * image.naturalWidth;
  const sourceHeight = heightFraction * image.naturalHeight;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new BackgroundRemovalError('The framed crop is empty. Adjust the framing and try again.');
  }

  const scale = Math.min(1, MAX_CROP_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvasContext(canvas);
  context.drawImage(
    image,
    x * image.naturalWidth,
    y * image.naturalHeight,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  return {
    aspectRatio: width / Math.max(1, height),
    canvas,
    colors: sampleColors(canvas, grid),
    height,
    width,
  };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new BackgroundRemovalError('The framed crop could not be encoded.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function fallbackFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv-${(hash >>> 0).toString(16)}`;
}

async function cropFingerprint(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return fallbackFingerprint(bytes);
}

/**
 * Area-average the provider alpha into the brick grid. This deliberately does
 * not keep a largest component or fill holes: groups and real openings remain.
 */
export function alphaToGridMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  grid: number = SEGMENT_GRID,
  threshold: number = SMART_MASK_ALPHA_THRESHOLD,
): boolean[] {
  if (width < 1 || height < 1 || grid < 1 || rgba.length < width * height * 4) {
    throw new BackgroundRemovalError('The background-removal mask is invalid.');
  }
  const mask = new Array<boolean>(grid * grid).fill(false);
  for (let gy = 0; gy < grid; gy++) {
    const y0 = Math.min(height - 1, Math.floor((gy * height) / grid));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(((gy + 1) * height) / grid)));
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.min(width - 1, Math.floor((gx * width) / grid));
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(((gx + 1) * width) / grid)));
      let alpha = 0;
      let samples = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          alpha += rgba[(py * width + px) * 4 + 3]!;
          samples++;
        }
      }
      mask[gy * grid + gx] = alpha / Math.max(1, samples * 255) >= threshold;
    }
  }
  return mask;
}

function providerFromHeader(value: string | null): Provider | undefined {
  return value === 'photoroom' || value === 'removebg' ? value : undefined;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // The proxy normally returns JSON errors; keep a stable fallback if not.
  }
  return 'Smart isolate could not process this crop.';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new BackgroundRemovalError('The isolated image could not be read.'));
    reader.onerror = () => reject(new BackgroundRemovalError('The isolated image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function decodeCutout(blob: Blob, grid: number): Promise<{ mask: boolean[]; uri: string }> {
  // A data URL has an ordinary GC lifecycle. Blob URLs leaked when cached
  // cutouts were replaced and could also be revoked while a build still used one.
  const uri = await blobToDataUrl(blob);
  const image = await loadBrowserImage(uri);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvasContext(canvas);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = alphaToGridMask(pixels, canvas.width, canvas.height, grid);
  if (!mask.some(Boolean)) {
    throw new BackgroundRemovalError('No clear subject was found. Keep the scene or try another crop.');
  }
  return { mask, uri };
}

async function requestSmartCutout(png: Blob, grid: number): Promise<CachedCutout> {
  const form = new FormData();
  form.append('image', png, 'crop.png');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(REMOVE_ENDPOINT, {
      body: form,
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new BackgroundRemovalError(await readError(response), response.status);
    }
    const provider = providerFromHeader(response.headers.get('X-Background-Removal-Provider'));
    const { mask, uri: cutoutUri } = await decodeCutout(await response.blob(), grid);
    return { cutoutUri, mask, provider };
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      throw new BackgroundRemovalError('Smart isolate timed out. Keep the scene or try again.', 504);
    }
    if (error instanceof BackgroundRemovalError) throw error;
    throw new BackgroundRemovalError('Smart isolate could not connect. Keep the scene or try again.');
  } finally {
    clearTimeout(timeout);
  }
}

/** Build the default, fully local segmentation without running the heuristic. */
export async function segmentFramedScene(
  uri: string,
  region: SegmentationRegion,
  grid: number = SEGMENT_GRID,
): Promise<Segmentation> {
  const crop = await rasterizeFramedCrop(uri, region, grid);
  return {
    aspectRatio: crop.aspectRatio,
    backgroundMode: 'scene',
    colors: crop.colors,
    coverage: 1,
    grid,
    mask: new Array(grid * grid).fill(true),
    maskSource: 'full-frame',
    region,
  };
}

/**
 * Request and cache a provider cutout for one exact photo/crop. Failed calls
 * are removed from the cache so an explicit retry can make a fresh request.
 */
export async function smartIsolateRegion(
  uri: string,
  region: SegmentationRegion,
  grid: number = SEGMENT_GRID,
): Promise<Segmentation> {
  if (!isBackgroundRemovalEnabled()) {
    throw new BackgroundRemovalError('Smart isolate is unavailable in this build.', 503);
  }
  const crop = await rasterizeFramedCrop(uri, region, grid);
  const png = await canvasToPng(crop.canvas);
  const fingerprint = await cropFingerprint(png);
  const regionKey = [region.x, region.y, region.width, region.height]
    .map((value) => value.toFixed(7))
    .join(':');
  const cacheKey = `${fingerprint}:${crop.width}x${crop.height}:${grid}:${regionKey}`;
  let pending = cutoutCache.get(cacheKey);
  if (!pending) {
    pending = requestSmartCutout(png, grid);
    cutoutCache.set(cacheKey, pending);
    pending.catch(() => cutoutCache.delete(cacheKey));
    while (cutoutCache.size > MAX_CACHED_CUTOUTS) {
      const oldest = cutoutCache.keys().next().value as string | undefined;
      if (!oldest) break;
      cutoutCache.delete(oldest);
    }
  }
  const cutout = await pending;
  const mask = [...cutout.mask];
  return {
    aspectRatio: crop.aspectRatio,
    backgroundMode: 'smart',
    backgroundRemovalProvider: cutout.provider,
    colors: crop.colors,
    coverage: mask.filter(Boolean).length / mask.length,
    cutoutUri: cutout.cutoutUri,
    grid,
    mask,
    maskSource: 'background-removal',
    region,
  };
}

export function backgroundRemovalErrorMessage(error: unknown): string {
  if (error instanceof BackgroundRemovalError) return error.message;
  return 'Smart isolate failed. Your original scene is unchanged.';
}
