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
const SMART_MASK_STRONG_ALPHA = 0.8;
const SMART_MASK_MIN_STRONG_COVERAGE = 0.06;

export interface IsolationExpectedBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface IsolationAssessment {
  coverage: number;
  reason?:
    | 'background-retained'
    | 'fragmented-subject'
    | 'incomplete-expected-extent'
    | 'subject-core-gap'
    | 'subject-too-small';
  verdict: 'accept' | 'review' | 'reject';
}

export interface SmartIsolationOptions {
  /** COCO/category hint. Used only for conservative, category-safe checks. */
  subjectHint?: string;
  /** Detector box mapped into this crop (0..1), when detection succeeded. */
  expectedBounds?: IsolationExpectedBounds;
}

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
      let stronglyOwned = 0;
      let samples = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const value = rgba[(py * width + px) * 4 + 3]!;
          alpha += value;
          if (value / 255 >= SMART_MASK_STRONG_ALPHA) stronglyOwned++;
          samples++;
        }
      }
      // Area averaging avoids one-pixel halos. The second clause rescues a
      // genuinely opaque thin feature (hair, glasses, spokes, straps) even
      // when it occupies less than the average-alpha threshold of a cell.
      mask[gy * grid + gx] =
        alpha / Math.max(1, samples * 255) >= threshold ||
        (threshold <= SMART_MASK_ALPHA_THRESHOLD &&
          stronglyOwned / Math.max(1, samples) >= SMART_MASK_MIN_STRONG_COVERAGE);
    }
  }
  return mask;
}

interface MaskBounds extends IsolationExpectedBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function maskBounds(mask: boolean[], grid: number): MaskBounds | null {
  let left = grid;
  let right = -1;
  let top = grid;
  let bottom = -1;
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const x = index % grid;
    const y = (index / grid) | 0;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return null;
  return {
    bottom,
    height: (bottom - top + 1) / grid,
    left,
    right,
    top,
    width: (right - left + 1) / grid,
    x: left / grid,
    y: top / grid,
  };
}

function componentSizes(mask: boolean[], grid: number): number[] {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      size++;
      const x = index % grid;
      const y = (index / grid) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * grid + nx;
        if (nx < 0 || ny < 0 || nx >= grid || ny >= grid || !mask[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

function cropBounds(bounds: IsolationExpectedBounds): IsolationExpectedBounds | null {
  const x = Math.max(0, Math.min(1, bounds.x));
  const y = Math.max(0, Math.min(1, bounds.y));
  const right = Math.max(x, Math.min(1, bounds.x + bounds.width));
  const bottom = Math.max(y, Math.min(1, bounds.y + bounds.height));
  if (right - x < 0.05 || bottom - y < 0.05) return null;
  return { height: bottom - y, width: right - x, x, y };
}

/**
 * Detect the characteristic "transparent shirt" failure: a person-shaped
 * matte has foreground on both sides of the torso but a background channel
 * cuts through its centre for several consecutive rows. This check is never
 * applied to vehicles/products, where real openings are common.
 */
function portraitCoreGapRatio(mask: boolean[], grid: number, bounds: MaskBounds): number {
  const boxWidth = bounds.right - bounds.left + 1;
  const boxHeight = bounds.bottom - bounds.top + 1;
  if (boxWidth < 8 || boxHeight < 12) return 0;
  const centre = Math.round((bounds.left + bounds.right) / 2);
  // Upper/middle body only: stopping around 64% avoids interpreting the
  // legitimate space between a full-body subject's legs as missing clothing.
  const startY = bounds.top + Math.round(boxHeight * 0.34);
  const endY = bounds.top + Math.round(boxHeight * 0.64);
  const maximumGap = Math.max(2, Math.round(boxWidth * 0.46));
  let eligibleRows = 0;
  let splitRows = 0;

  for (let y = startY; y <= endY; y++) {
    let left = centre;
    while (left >= bounds.left && !mask[y * grid + left]) left--;
    let right = centre;
    while (right <= bounds.right && !mask[y * grid + right]) right++;
    if (left < bounds.left || right > bounds.right) continue;
    eligibleRows++;
    const gap = right - left - 1;
    if (gap >= Math.max(2, Math.round(boxWidth * 0.08)) && gap <= maximumGap) splitRows++;
  }
  return eligibleRows >= 4 ? splitRows / eligibleRows : 0;
}

/**
 * Layer 2 after provider semantics: reject obvious truncation, and mark
 * ambiguous topology for review. We intentionally do not infer foreground
 * from colour; white clothes on a white wall are an ownership problem, not a
 * colour-distance problem.
 */
export function assessIsolationMask(
  mask: boolean[],
  grid: number,
  options: SmartIsolationOptions = {},
): IsolationAssessment {
  const foreground = mask.reduce((sum, on) => sum + (on ? 1 : 0), 0);
  const coverage = foreground / Math.max(1, mask.length);
  const bounds = maskBounds(mask, grid);
  if (!bounds || coverage < 0.02) {
    return { coverage, reason: 'subject-too-small', verdict: 'reject' };
  }

  let borderOwned = 0;
  let borderCells = 0;
  for (let index = 0; index < grid; index++) {
    for (const cell of [index, (grid - 1) * grid + index, index * grid, index * grid + grid - 1]) {
      borderCells++;
      if (mask[cell]) borderOwned++;
    }
  }
  if (coverage > 0.975 || (coverage > 0.72 && borderOwned / borderCells > 0.82)) {
    return { coverage, reason: 'background-retained', verdict: 'reject' };
  }

  const expected = options.expectedBounds ? cropBounds(options.expectedBounds) : null;
  if (expected) {
    const widthRatio = bounds.width / expected.width;
    const heightRatio = bounds.height / expected.height;
    const actualCentreX = bounds.x + bounds.width / 2;
    const actualCentreY = bounds.y + bounds.height / 2;
    const expectedCentreX = expected.x + expected.width / 2;
    const expectedCentreY = expected.y + expected.height / 2;
    const shifted =
      Math.abs(actualCentreX - expectedCentreX) > Math.max(0.16, expected.width * 0.32) ||
      Math.abs(actualCentreY - expectedCentreY) > Math.max(0.16, expected.height * 0.32);
    if (widthRatio < 0.5 || heightRatio < 0.5 || shifted) {
      return { coverage, reason: 'incomplete-expected-extent', verdict: 'reject' };
    }
    if (widthRatio < 0.68 || heightRatio < 0.68) {
      return { coverage, reason: 'incomplete-expected-extent', verdict: 'review' };
    }
  }

  if (/\b(person|portrait|human)\b/i.test(options.subjectHint ?? '')) {
    const gapRatio = portraitCoreGapRatio(mask, grid, bounds);
    if (gapRatio >= 0.5) {
      return { coverage, reason: 'subject-core-gap', verdict: 'reject' };
    }
    if (gapRatio >= 0.25) {
      return { coverage, reason: 'subject-core-gap', verdict: 'review' };
    }
  }

  const sizes = componentSizes(mask, grid);
  const significant = sizes.filter((size) => size >= Math.max(3, foreground * 0.01));
  const largestShare = (sizes[0] ?? 0) / foreground;
  if (significant.length >= 5 && largestShare < 0.5) {
    return { coverage, reason: 'fragmented-subject', verdict: 'reject' };
  }
  if (significant.length >= 3 && largestShare < 0.72) {
    return { coverage, reason: 'fragmented-subject', verdict: 'review' };
  }
  if (coverage < 0.045 || coverage > 0.82) {
    return { coverage, reason: coverage < 0.045 ? 'subject-too-small' : 'background-retained', verdict: 'review' };
  }
  return { coverage, verdict: 'accept' };
}

function assessmentMessage(assessment: IsolationAssessment): string {
  if (assessment.reason === 'subject-core-gap') {
    return 'Smart isolate may have removed part of this person, such as light clothing. The cutout was not applied. Reframe closer or keep the scene.';
  }
  if (assessment.reason === 'incomplete-expected-extent' || assessment.reason === 'fragmented-subject') {
    return 'Smart isolate returned an incomplete subject. The cutout was not applied. Reframe closer or keep the scene.';
  }
  if (assessment.reason === 'background-retained') {
    return 'Smart isolate could not separate this subject from the background. The cutout was not applied. Try a tighter crop.';
  }
  return 'No complete subject was found. The cutout was not applied. Reframe closer or keep the scene.';
}

function reviewMessage(assessment: IsolationAssessment): string | undefined {
  if (assessment.verdict !== 'review') return undefined;
  if (assessment.reason === 'subject-core-gap') {
    return 'Check light clothing in the isolated preview; the mask is uncertain through the centre of the subject.';
  }
  if (assessment.reason === 'incomplete-expected-extent') {
    return 'Check that the isolated preview includes the entire subject before continuing.';
  }
  return 'Check the isolated preview carefully; the subject outline is unusually complex.';
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

function providerSubjectHint(value: string | undefined): string | undefined {
  const hint = value?.trim().toLowerCase();
  return hint && /^[a-z -]{1,32}$/.test(hint) ? hint : undefined;
}

async function requestSmartCutout(
  png: Blob,
  grid: number,
  subjectHint?: string,
): Promise<CachedCutout> {
  const form = new FormData();
  form.append('image', png, 'crop.png');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(REMOVE_ENDPOINT, {
      body: form,
      headers: subjectHint ? { 'X-PixBrik-Subject-Hint': subjectHint } : undefined,
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
  options: SmartIsolationOptions = {},
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
  const hint = providerSubjectHint(options.subjectHint);
  const cacheKey = `${fingerprint}:${crop.width}x${crop.height}:${grid}:${regionKey}:${hint ?? 'auto'}`;
  let pending = cutoutCache.get(cacheKey);
  if (!pending) {
    pending = requestSmartCutout(png, grid, hint);
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
  const assessment = assessIsolationMask(mask, grid, options);
  if (assessment.verdict === 'reject') {
    throw new BackgroundRemovalError(assessmentMessage(assessment), 422);
  }
  return {
    aspectRatio: crop.aspectRatio,
    backgroundMode: 'smart',
    backgroundRemovalProvider: cutout.provider,
    colors: crop.colors,
    coverage: mask.filter(Boolean).length / mask.length,
    cutoutUri: cutout.cutoutUri,
    grid,
    isolationQuality: assessment.verdict === 'review' ? 'review' : 'passed',
    isolationWarning: reviewMessage(assessment),
    mask,
    maskSource: 'background-removal',
    region,
  };
}

export function backgroundRemovalErrorMessage(error: unknown): string {
  if (error instanceof BackgroundRemovalError) return error.message;
  return 'Smart isolate failed. Your original scene is unchanged.';
}
