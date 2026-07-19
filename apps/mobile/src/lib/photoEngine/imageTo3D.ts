/**
 * Image-to-3D (Tier-2). Turns a photo into a full 3D mesh, then voxelizes it
 * into bricks with real geometry on every side — the step-change beyond
 * single-view silhouette inflation.
 *
 * Live generation (TripoSR / Tripo / Stable-Fast-3D class models) runs on a
 * GPU, so it needs a hosted API key or a small backend — configure `MESH_API`
 * to enable it. Until then the demo path voxelizes a real downloaded mesh so
 * the mesh→brick pipeline is fully demonstrable end-to-end.
 */

import type { VoxelModel } from '../voxelFox';
import { smartIsolateRegion } from './backgroundRemoval';
import { segmentRegion, type Segmentation } from './segment';
import { quantizeToCatalog, type PhotoModels } from './voxelizePhoto';
import { voxelizeGlbUrl, voxelizeGlbUrlOne } from './meshVoxelize';

export { recolorPhotoModels } from './meshFidelity';
export type { MeshBrickColorStyle } from './meshFidelity';

/**
 * Live image-to-3D runs through our Meshy and Tripo serverless proxies, so
 * provider keys stay server-side and never ship in the browser bundle. This
 * public flag gates both provider paths; it is a UI capability toggle, not a
 * secret or an authorization boundary. The older Tripo-named flag remains a
 * compatibility fallback so existing deployments do not lose the feature.
 */
export function isLive3DConfigured(): boolean {
  return (
    (process.env.EXPO_PUBLIC_3D_GENERATION_ENABLED ?? '') === '1'
    || (process.env.EXPO_PUBLIC_MESHY_ENABLED ?? '') === '1'
    || (process.env.EXPO_PUBLIC_TRIPO_ENABLED ?? '') === '1'
  );
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Live photo→3D is off. Enable 3D generation for this deployment and configure a server-side Meshy or Tripo key.');
    this.name = 'NotConfiguredError';
  }
}

export class GenerationSubmitError extends Error {
  constructor(
    message: string,
    readonly provider: MeshEngine,
    readonly status: number | null,
    /** True only when the server confirmed that no provider task was created. */
    readonly definitivePreTaskRejection: boolean,
  ) {
    super(message);
    this.name = 'GenerationSubmitError';
  }
}

export class NoCreditError extends GenerationSubmitError {
  constructor(provider: MeshEngine) {
    const label = provider === 'meshy' ? 'Meshy' : 'Tripo';
    super(`${label} has insufficient generation credits.`, provider, 402, true);
    this.name = 'NoCreditError';
  }
}

/**
 * A single portrait cannot provide evidence for the back or sides of a head.
 * Route known people to real multiview capture instead of asking a generator
 * to mirror or invent facial texture on unseen surfaces.
 */
export function requiresGuidedMultiview(
  segmentation: Segmentation | null | undefined,
): boolean {
  if (segmentation?.face) return true;
  const category = segmentation?.categoryLabel?.trim().toLowerCase() ?? '';
  return /\b(person|portrait|human)\b/.test(category);
}

export class GuidedMultiviewRequiredError extends Error {
  constructor() {
    super(
      'People need four guided photos (front, left, back and right). One photo cannot show the unseen sides of a head.',
    );
    this.name = 'GuidedMultiviewRequiredError';
  }
}

function requireSafeSinglePhotoSubject(
  segmentation: Segmentation | null | undefined,
): void {
  if (requiresGuidedMultiview(segmentation)) {
    throw new GuidedMultiviewRequiredError();
  }
}

/**
 * Demo mesh for the pipeline: the Khronos "Duck" glTF sample.
 * Duck model © Sony Computer Entertainment Inc., SCEA Shared Source License 1.0.
 * Fetched at runtime for demonstration; not bundled with the app.
 */
export const DEMO_MESHES = [
  {
    id: 'duck',
    label: 'Duck',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb',
    credit: 'Khronos glTF sample',
  },
  {
    id: 'car',
    label: 'Concept Car',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',
    credit: 'Darmstadt Graphics Group / Khronos glTF sample (CC BY 4.0)',
  },
] as const;

/** Voxelize a mesh at a URL into a FotoBrik build. */
export async function buildFromMeshUrl(url: string, label: string): Promise<PhotoModels> {
  const models = await voxelizeGlbUrl(url);
  return { hasDepth: true, label, mode: 'volume', models, style: 'natural' };
}

/**
 * Lab variant: voxelize a mesh at ONE profile instead of all three — the lab
 * compares candidates at a single fidelity, so building the rest is waste.
 */
export async function buildFromMeshUrlOne(
  url: string,
  label: string,
  profile: 'efficient' | 'balanced' | 'detailed' = 'balanced',
): Promise<PhotoModels> {
  const model = await voxelizeGlbUrlOne(url, profile);
  return {
    hasDepth: true,
    label,
    mode: 'volume',
    models: { balanced: model, detailed: model, efficient: model },
    style: 'natural',
  };
}

function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function tint(target: string, factor: number): string {
  const clean = target.replace('#', '');
  const scale = (offset: number) => {
    const channel = Number.parseInt(clean.slice(offset, offset + 2), 16);
    return Math.max(0, Math.min(255, Math.round(channel * factor)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${scale(0)}${scale(2)}${scale(4)}`;
}

/** Recolour a model to a single hue, keeping each cell's brightness (shading). */
function recolour(model: VoxelModel, colorHex: string): VoxelModel {
  const colors = new Map<string, string>();
  const cells = model.cells.map((cell) => {
    const tinted = tint(colorHex, 0.45 + 0.85 * hexLuminance(cell.colorHex ?? '#888888'));
    const next = quantizeToCatalog(
      Number.parseInt(tinted.slice(1, 3), 16),
      Number.parseInt(tinted.slice(3, 5), 16),
      Number.parseInt(tinted.slice(5, 7), 16),
    );
    colors.set(`${cell.i}|${cell.j}|${cell.k}`, next);
    return { ...cell, colorHex: next };
  });
  const shell = model.shell.map((cell) => ({
    ...cell,
    colorHex: colors.get(`${cell.i}|${cell.j}|${cell.k}`) ?? colorHex,
    exposed: [...cell.exposed],
  }));
  // A finish change must never run geometry heuristics again. The old
  // recolour path re-detected slopes and visibly eroded approved cars.
  return { ...model, cells, shell };
}

/**
 * Library build: create the same three genuine fidelity profiles as an
 * approved provider model and, when a colour is chosen, recolour each without
 * changing occupancy. Users can therefore compare real size/detail options.
 */
export async function buildFromLibrary(
  url: string,
  label: string,
  colorHex?: string,
  onProgress?: (fraction: number) => void,
): Promise<PhotoModels> {
  const base = await voxelizeGlbUrl(url, onProgress);
  const models = colorHex
    ? {
        balanced: recolour(base.balanced, colorHex),
        detailed: recolour(base.detailed, colorHex),
        efficient: recolour(base.efficient, colorHex),
      }
    : base;
  return {
    hasDepth: true,
    label,
    mode: 'volume',
    models,
    style: 'natural',
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not load photo'));
    image.src = src;
  });
}

const FULL_FRAME_MASK_THRESHOLD = 0.98;
const MIN_SUBJECT_COVERAGE = 0.02;

export class SubjectIsolationRequiredError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `PixBrik could not isolate the subject for True 3D: ${detail}`
        : 'PixBrik could not isolate the subject for True 3D. Try Smart isolate again before generating the model.',
    );
    this.name = 'SubjectIsolationRequiredError';
  }
}

function preserveSubjectMetadata(
  isolated: Segmentation,
  original: Segmentation,
): Segmentation {
  return {
    ...isolated,
    categoryLabel: original.categoryLabel,
    face: original.face,
    preserveFeatures: original.preserveFeatures,
  };
}

/**
 * Capture keeps a full-frame mask for faithful panel previews. That mask is
 * correct for a mosaic, but wrong for image-to-3D providers: it tells the
 * provider that the wall, floor, and every other background pixel belong to
 * the object. Check both the stored signal and the actual mask so older saved
 * captures with stale coverage are handled too.
 */
export function needsSubjectMaskFor3D(segmentation: Segmentation): boolean {
  if (!segmentation.mask.length) {
    return false;
  }
  const maskCoverage = segmentation.mask.reduce((sum, on) => sum + (on ? 1 : 0), 0) / segmentation.mask.length;
  return segmentation.coverage >= FULL_FRAME_MASK_THRESHOLD || maskCoverage >= FULL_FRAME_MASK_THRESHOLD;
}

/**
 * Recover the subject silhouette only for the optional 3D path. The panel's
 * stored full-frame segmentation remains untouched, so its appearance does
 * not change. A failed/degenerate recovery stops before a paid 3D request;
 * sending the original scene would manufacture a misleading model.
 */
export async function prepareSegmentationFor3D(
  photoUri: string,
  segmentation: Segmentation,
): Promise<Segmentation> {
  // A provider matte is already the best available True-3D input. A full-frame
  // mask, however, is only a panel preference: sending it to a 3D generator
  // would model the wall/floor as part of the object. Obtain a separate smart
  // matte without mutating the panel segmentation.
  if (segmentation.maskSource === 'background-removal') {
    return segmentation;
  }
  if (segmentation.maskSource === 'full-frame') {
    try {
      const isolated = await smartIsolateRegion(
        photoUri,
        segmentation.region,
        segmentation.grid,
        { subjectHint: segmentation.categoryLabel },
      );
      return preserveSubjectMetadata(isolated, segmentation);
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message;
      const detail = typeof message === 'string' ? message : undefined;
      throw new SubjectIsolationRequiredError(detail);
    }
  }
  if (!needsSubjectMaskFor3D(segmentation)) {
    return segmentation;
  }

  const isolated = await segmentRegion(photoUri, segmentation.region, segmentation.grid);
  if (isolated.coverage < MIN_SUBJECT_COVERAGE || isolated.coverage >= FULL_FRAME_MASK_THRESHOLD) {
    throw new SubjectIsolationRequiredError();
  }

  return preserveSubjectMetadata(isolated, segmentation);
}

interface Prepared3DPhoto {
  preserveAlpha: boolean;
  uri: string;
}

/** Prepare a neutral-background subject image without mutating panel data. */
async function cutoutFor3D(
  photoUri: string,
  segmentation: Segmentation,
): Promise<Prepared3DPhoto> {
  const isolated = await prepareSegmentationFor3D(photoUri, segmentation);
  // Preserve the provider's high-resolution RGBA edge matte for 3D. Rebuilding
  // it from the 68-cell brick mask would reintroduce the blocky halo the smart
  // isolate service was added to avoid. This also covers a keep-scene panel
  // whose separate True-3D matte was obtained just above.
  if (isolated.maskSource === 'background-removal' && isolated.cutoutUri) {
    return { preserveAlpha: true, uri: isolated.cutoutUri };
  }
  return { preserveAlpha: false, uri: await compositeCutout(photoUri, isolated) };
}

/**
 * Crop to the object's region and punch out everything the segmentation
 * mask says is background, replacing it with a plain neutral backdrop.
 * Image-to-3D generation (Tripo) expects an isolated subject on a clean
 * background — like the product photography it's trained on — not a full
 * scene with an arbitrarily-cropped subject and a real wall behind it.
 * Reuses the segmentation the app already computed. When Capture deliberately
 * stored an all-on mask for a full-frame panel, the inexpensive deterministic
 * segmenter is rerun here so the optional 3D provider receives a subject, not
 * the entire scene.
 */
async function compositeCutout(photoUri: string, segmentation: Segmentation): Promise<string> {
  const image = await loadImageElement(photoUri);
  const { region, mask, grid } = segmentation;
  const cropWidth = Math.max(1, Math.round(region.width * image.naturalWidth));
  const cropHeight = Math.max(1, Math.round(region.height * image.naturalHeight));

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return photoUri;
  }

  const BACKDROP = 0xf2;
  context.fillStyle = `rgb(${BACKDROP}, ${BACKDROP}, ${BACKDROP})`;
  context.fillRect(0, 0, cropWidth, cropHeight);
  context.drawImage(
    image,
    region.x * image.naturalWidth,
    region.y * image.naturalHeight,
    region.width * image.naturalWidth,
    region.height * image.naturalHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  const pixels = context.getImageData(0, 0, cropWidth, cropHeight);
  const data = pixels.data;
  for (let y = 0; y < cropHeight; y++) {
    const gy = Math.min(grid - 1, Math.floor((y / cropHeight) * grid));
    for (let x = 0; x < cropWidth; x++) {
      const gx = Math.min(grid - 1, Math.floor((x / cropWidth) * grid));
      if (!mask[gy * grid + gx]) {
        const index = (y * cropWidth + x) * 4;
        data[index] = BACKDROP;
        data[index + 1] = BACKDROP;
        data[index + 2] = BACKDROP;
        data[index + 3] = 255;
      }
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.94);
}

/** Downscale any image src (data:/blob:/http) to a compact JPEG data URL so
 * the POST body stays under the serverless 4.5 MB limit. Web-only (canvas). */
export async function toCompactDataUrl(
  src: string,
  max = 1024,
  quality = 0.92,
  preserveAlpha = false,
): Promise<string> {
  if (typeof document === 'undefined') {
    return src;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('could not load photo'));
    img.src = src;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return src;
  }
  ctx.drawImage(img, 0, 0, w, h);
  return preserveAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
}

/** Leave headroom below common serverless request limits for JSON and headers. */
const MAX_GENERATION_JSON_CHARS = 3_600_000;
const COMPACTION_PRESETS = [
  { max: 1024, quality: 0.92 },
  { max: 896, quality: 0.88 },
  { max: 768, quality: 0.84 },
  { max: 640, quality: 0.8 },
] as const;

async function compactSingleWithinBudget(src: string, preserveAlpha: boolean): Promise<string> {
  for (const preset of COMPACTION_PRESETS) {
    const result = await toCompactDataUrl(src, preset.max, preset.quality, preserveAlpha);
    if (JSON.stringify({ image: result }).length <= MAX_GENERATION_JSON_CHARS) return result;
  }
  throw new Error('The prepared photo is still too large to upload. Crop closer to the subject and try again.');
}

async function compactMultiviewWithinBudget(shots: MultiviewShots): Promise<Record<string, string>> {
  for (const preset of COMPACTION_PRESETS) {
    const views: Record<string, string> = {};
    for (const name of MULTIVIEW_ORDER) {
      views[name] = await toCompactDataUrl(shots[name]!, preset.max, preset.quality);
    }
    if (JSON.stringify({ views }).length <= MAX_GENERATION_JSON_CHARS) return views;
  }
  throw new Error('The four prepared photos are too large to upload. Retake them with tighter framing.');
}

/** Report generation progress (0–1) while the model is being built. */
export type ProgressFn = (fraction: number, note: string) => void;

/**
 * Tripo generations the comparison lab can request. Must stay in sync with
 * the server-side whitelist in api/tripo/submit.ts. Credit costs are per
 * Tripo's pricing and can differ per version — treat as estimates.
 */
export const TRIPO_VERSIONS = [
  { id: 'v1.4-20240625', label: 'Tripo v1.4', note: 'oldest · cheapest' },
  { id: 'v2.0-20240919', label: 'Tripo v2.0', note: 'legacy baseline' },
  { id: 'v2.5-20250123', label: 'Tripo v2.5', note: 'balanced' },
  { id: 'v3.0-20250812', label: 'Tripo v3.0', note: 'high detail' },
  { id: 'v3.1-20260211', label: 'Tripo v3.1', note: 'quality default' },
  { id: 'P1-20260311', label: 'Tripo P1', note: 'newest · premium' },
] as const;

export type TripoVersionId = (typeof TRIPO_VERSIONS)[number]['id'];

/** Which hosted image→3D generator to use. */
export type MeshEngine = 'tripo' | 'meshy';
type MeshGenerationMode = 'single' | 'multiview';

export interface BuildFromPhotoOptions {
  /** Generator to use. Default 'tripo' (the lab's version cards). */
  engine?: MeshEngine;
  /** Specific Tripo generation to use (lab comparisons). Server default otherwise. */
  modelVersion?: TripoVersionId;
  onProgress?: ProgressFn;
  /** Called only after a provider accepts a brand-new paid task. Resumes do not call it. */
  onProviderTaskCreated?: () => void;
  /**
   * Receives the generated mesh's URL as soon as it is ready, before brick
   * conversion — the lab uses it to show the raw 3D output next to the
   * brick proposal.
   */
  onMeshUrl?: (url: string) => void;
}

const ENGINE_BASE: Record<MeshEngine, string> = {
  meshy: '/api/meshy',
  tripo: '/api/tripo',
};

const PROVIDER_LABEL: Record<MeshEngine, string> = {
  meshy: 'Meshy',
  tripo: 'Tripo',
};

const PENDING_TASK_STORAGE_KEY = 'pixbrik.pendingGeneration.v1';
const PENDING_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PendingGenerationTask {
  createdAt: number;
  engine: MeshEngine;
  fingerprint: string;
  /** Optional so one-photo tasks saved before multiview routing still resume. */
  mode?: MeshGenerationMode;
  taskId: string;
}

class GenerationTaskTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationTaskTerminalError';
  }
}

let memoryPendingTask: PendingGenerationTask | null = null;

function pendingTaskStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function taskFingerprint(kind: string, body: Record<string, unknown>): string {
  const value = `${kind}:${JSON.stringify(body)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}:${value.length}:${(hash >>> 0).toString(16)}`;
}

function readPendingTask(fingerprint: string): PendingGenerationTask | null {
  let pending = memoryPendingTask;
  const store = pendingTaskStorage();
  if (store) {
    try {
      const raw = store.getItem(PENDING_TASK_STORAGE_KEY);
      pending = raw ? (JSON.parse(raw) as PendingGenerationTask) : null;
    } catch {
      pending = null;
    }
  }
  if (
    !pending ||
    pending.fingerprint !== fingerprint ||
    Date.now() - pending.createdAt > PENDING_TASK_MAX_AGE_MS
  ) {
    return null;
  }
  return pending;
}

function rememberPendingTask(task: PendingGenerationTask): void {
  memoryPendingTask = task;
  try {
    pendingTaskStorage()?.setItem(PENDING_TASK_STORAGE_KEY, JSON.stringify(task));
  } catch {
    // In-memory resume still protects this mounted session.
  }
}

function forgetPendingTask(task: PendingGenerationTask): void {
  if (memoryPendingTask?.taskId === task.taskId) memoryPendingTask = null;
  const store = pendingTaskStorage();
  try {
    const raw = store?.getItem(PENDING_TASK_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as PendingGenerationTask) : null;
    if (saved?.taskId === task.taskId) store?.removeItem(PENDING_TASK_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

function isDefinitivePreTaskResponse(status: number, message: string): boolean {
  return (
    (status >= 400 && status < 500) ||
    (status === 500 && /API_KEY is not configured on the server/i.test(message))
  );
}

/** Submit a generation task; resolves to its taskId. */
async function submitTask(engine: MeshEngine, body: Record<string, unknown>): Promise<string> {
  const base = ENGINE_BASE[engine];
  const label = PROVIDER_LABEL[engine];
  let submit: Response;
  try {
    submit = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new GenerationSubmitError(
      `${label} submission could not be confirmed.${detail} No fallback was started because the task may already exist.`,
      engine,
      null,
      false,
    );
  }
  if (!submit.ok) {
    if (submit.status === 402) {
      throw new NoCreditError(engine);
    }
    const parsed = (await submit.json().catch(() => null)) as { error?: string } | null;
    const detail = parsed?.error || `${label} generation could not start (${submit.status})`;
    throw new GenerationSubmitError(
      detail,
      engine,
      submit.status,
      isDefinitivePreTaskResponse(submit.status, detail),
    );
  }
  // A malformed success is ambiguous: a paid task may already exist.
  const payload = (await submit.json().catch(() => null)) as { taskId?: unknown } | null;
  const taskId = payload?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    throw new GenerationSubmitError(
      `${label} returned no task ID. No fallback was started because task creation is uncertain.`,
      engine,
      submit.status,
      false,
    );
  }
  return taskId;
}

/** Poll a submitted task until its mesh is ready; resolves to the mesh URL. */
async function awaitTask(
  engine: MeshEngine,
  taskId: string,
  onProgress?: ProgressFn,
  mode: MeshGenerationMode = 'single',
): Promise<string> {
  const base = ENGINE_BASE[engine];
  const label = PROVIDER_LABEL[engine];
  const meshyTaskKind =
    engine === 'meshy' && mode === 'multiview'
      ? '&taskKind=multi-image-to-3d'
      : '';
  let ready = false;
  let lastStatusError = '';
  for (let attempt = 0; attempt < 90 && !ready; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let statusRes: Response;
    try {
      statusRes = await fetch(
        `${base}/status?taskId=${encodeURIComponent(taskId)}${meshyTaskKind}`,
      );
    } catch (error) {
      lastStatusError = error instanceof Error ? error.message : 'network error';
      continue;
    }
    if (!statusRes.ok) {
      const parsed = (await statusRes.json().catch(() => null)) as { error?: string } | null;
      lastStatusError = parsed?.error || `status check failed (${statusRes.status})`;
      if ([400, 404, 422].includes(statusRes.status)) {
        throw new GenerationTaskTerminalError(`${label} task status failed: ${lastStatusError}`);
      }
      continue;
    }
    const body = (await statusRes.json()) as {
      status: string;
      progress?: number;
      hasModel?: boolean;
      error?: string;
    };
    if (body.status === 'success' && body.hasModel) {
      ready = true;
    } else if (['failed', 'cancelled', 'canceled', 'banned', 'expired'].includes(body.status)) {
      throw new GenerationTaskTerminalError(
        `${label} generation ${body.status}${body.error ? `: ${body.error}` : ''}`,
      );
    } else {
      // Map the generator's 0–100 progress into the 0.15–0.9 band.
      onProgress?.(0.15 + 0.75 * ((body.progress ?? 0) / 100), 'Sculpting 3D model');
    }
  }
  if (!ready) {
    throw new Error(
      `${label} generation timed out${lastStatusError ? `; last status error: ${lastStatusError}` : ''}. Retry resumes this existing task; it will not submit or charge for another generation.`,
    );
  }
  return `${base}/model?taskId=${encodeURIComponent(taskId)}${meshyTaskKind}`;
}

async function awaitRememberedTask(
  pending: PendingGenerationTask,
  onProgress?: ProgressFn,
): Promise<string> {
  try {
    const meshUrl = await awaitTask(
      pending.engine,
      pending.taskId,
      onProgress,
      pending.mode ?? 'single',
    );
    forgetPendingTask(pending);
    return meshUrl;
  } catch (error) {
    // A terminal provider state can be intentionally regenerated. Transient
    // polling/network failures retain the task so Retry resumes instead of
    // creating a second paid job.
    if (error instanceof GenerationTaskTerminalError) forgetPendingTask(pending);
    throw error;
  }
}

async function submitRememberedTask(
  engine: MeshEngine,
  body: Record<string, unknown>,
  fingerprint: string,
  onProgress?: ProgressFn,
  mode: MeshGenerationMode = 'single',
  onProviderTaskCreated?: () => void,
): Promise<string> {
  const resumed = readPendingTask(fingerprint);
  if (resumed) {
    onProgress?.(0.15, `Resuming existing ${PROVIDER_LABEL[resumed.engine]} task`);
    return awaitRememberedTask(resumed, onProgress);
  }
  const taskId = await submitTask(engine, body);
  onProviderTaskCreated?.();
  const pending = { createdAt: Date.now(), engine, fingerprint, mode, taskId };
  rememberPendingTask(pending);
  return awaitRememberedTask(pending, onProgress);
}

/**
 * Shared generation tail: submit a task body to a generator proxy, poll
 * until the mesh is ready, then voxelize it into all three genuinely
 * different brick resolutions. The single-photo and multiview paths both end
 * here — only the submit body and engine differ.
 */
async function generateAndVoxelize(
  engine: MeshEngine,
  submitBody: Record<string, unknown>,
  options: BuildFromPhotoOptions,
): Promise<PhotoModels> {
  const onProgress = options.onProgress;
  onProgress?.(0.12, 'Uploading to generator');
  const fingerprint = taskFingerprint(`direct-${engine}`, submitBody);
  const meshUrl = await submitRememberedTask(
    engine,
    submitBody,
    fingerprint,
    onProgress,
    'single',
    options.onProviderTaskCreated,
  );
  onProgress?.(0.9, 'Converting to bricks');
  options.onMeshUrl?.(meshUrl);
  const models = await voxelizeGlbUrl(meshUrl, (fraction) =>
    onProgress?.(0.9 + fraction * 0.1, 'Converting to bricks'),
  );
  onProgress?.(1, 'Done');
  return {
    hasDepth: true,
    label: 'Your object',
    mode: 'volume',
    models,
    style: 'natural',
  };
}

/**
 * Generate a 3D mesh from a photo WITHOUT converting it — the approve-first
 * buyer flow shows this mesh for a yes/no before any bricks exist. Prefers
 * Meshy-6 and falls back to Tripo only after a confirmed pre-task rejection
 * (for example missing configuration or no credits). Network failures, 5xx
 * responses, and malformed success responses are ambiguous and never fall
 * back, because Meshy may already have created a paid task.
 */
export async function generateMeshFromPhoto(
  photoSrc: string,
  segmentation: Segmentation | null | undefined,
  options: BuildFromPhotoOptions = {},
): Promise<string> {
  requireSafeSinglePhotoSubject(segmentation);
  if (!isLive3DConfigured()) {
    throw new NotConfiguredError();
  }
  const onProgress = options.onProgress;
  onProgress?.(0.05, 'Preparing photo');
  const prepared = segmentation
    ? await cutoutFor3D(photoSrc, segmentation)
    : { preserveAlpha: false, uri: photoSrc };
  const image = await compactSingleWithinBudget(
    prepared.uri,
    prepared.preserveAlpha,
  );

  onProgress?.(0.12, 'Uploading to generator');
  const fingerprint = taskFingerprint('one-photo', {
    image,
    modelVersion: options.modelVersion ?? null,
  });
  try {
    return await submitRememberedTask(
      'meshy',
      { image },
      fingerprint,
      onProgress,
      'single',
      options.onProviderTaskCreated,
    );
  } catch (error) {
    if (!(error instanceof GenerationSubmitError) || !error.definitivePreTaskRejection) {
      throw error;
    }
    onProgress?.(0.12, 'Meshy rejected before creating a task; trying Tripo');
    return submitRememberedTask(
      'tripo',
      { image, modelVersion: options.modelVersion },
      fingerprint,
      onProgress,
      'single',
      options.onProviderTaskCreated,
    );
  }
}

/**
 * Convert an approved mesh into bricks at ALL THREE profiles, so the result
 * screen's build-profile tickets show genuinely different small/medium/
 * detailed builds with real per-profile pricing.
 */
export async function buildFromMeshUrlAllProfiles(
  url: string,
  label: string,
  onProgress?: ProgressFn,
): Promise<PhotoModels> {
  let models: Awaited<ReturnType<typeof voxelizeGlbUrl>>;
  try {
    models = await voxelizeGlbUrl(url, (fraction) => onProgress?.(fraction, 'Converting to bricks'));
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    throw new Error(
      `The 3D model was generated successfully, but PixBrik could not convert its mesh into bricks${detail}. Retry uses the already-paid model and does not spend more credits.`,
    );
  }
  onProgress?.(1, 'Done');
  return { hasDepth: true, label, mode: 'volume', models, style: 'natural' };
}

/**
 * Live path: photo → Tripo (via /api/tripo proxy) → GLB → bricks.
 * The key is held server-side; this only talks to our own origin.
 * Throws NotConfiguredError when the live path is off, NoCreditError when the
 * Tripo account is out of credit.
 */
export async function buildFromPhoto(
  photoSrc: string,
  segmentation?: Segmentation | null,
  onProgressOrOptions?: ProgressFn | BuildFromPhotoOptions,
): Promise<PhotoModels> {
  const options: BuildFromPhotoOptions =
    typeof onProgressOrOptions === 'function' ? { onProgress: onProgressOrOptions } : (onProgressOrOptions ?? {});
  requireSafeSinglePhotoSubject(segmentation);
  if (!isLive3DConfigured()) {
    throw new NotConfiguredError();
  }
  options.onProgress?.(0.05, 'Preparing photo');
  // Send the generator the isolated object (cropped + background removed)
  // whenever we already have a segmentation for this photo, not the raw scene.
  const prepared = segmentation
    ? await cutoutFor3D(photoSrc, segmentation)
    : { preserveAlpha: false, uri: photoSrc };
  const image = await toCompactDataUrl(
    prepared.uri,
    1024,
    0.92,
    prepared.preserveAlpha,
  );
  const engine = options.engine ?? 'tripo';
  const body =
    engine === 'meshy' ? { image } : { image, modelVersion: options.modelVersion };
  return generateAndVoxelize(engine, body, options);
}

/** The four orbit views, keyed the way the server expects them. */
export interface MultiviewShots {
  front: string;
  left?: string;
  back?: string;
  right?: string;
}

const MULTIVIEW_ORDER = ['front', 'left', 'back', 'right'] as const;

export function missingMultiviewShots(shots: MultiviewShots): Array<(typeof MULTIVIEW_ORDER)[number]> {
  return MULTIVIEW_ORDER.filter((name) => typeof shots[name] !== 'string' || !shots[name]);
}

/** Generate a Meshy or Tripo multiview mesh without starting brick conversion. */
export async function generateMeshFromMultiview(
  shots: MultiviewShots,
  options: BuildFromPhotoOptions = {},
): Promise<string> {
  if (!isLive3DConfigured()) {
    throw new NotConfiguredError();
  }
  const missing = missingMultiviewShots(shots);
  if (missing.length) {
    throw new Error(`Four guided photos are required; missing ${missing.join(', ')}.`);
  }

  options.onProgress?.(0.05, 'Preparing all four views');
  const views = await compactMultiviewWithinBudget(shots);
  const engine = options.engine ?? 'tripo';
  options.onProgress?.(0.12, `Uploading four views to ${PROVIDER_LABEL[engine]}`);
  const body =
    engine === 'meshy'
      ? { views }
      : { modelVersion: options.modelVersion, views };
  const fingerprint = taskFingerprint(`four-view-${engine}`, body);
  return submitRememberedTask(
    engine,
    body,
    fingerprint,
    options.onProgress,
    'multiview',
    options.onProviderTaskCreated,
  );
}

/**
 * Buyer-facing smart route: prefer Meshy-6's multi-image reconstruction, then
 * use Tripo only when Meshy definitively rejected the request before creating
 * a task. An ambiguous timeout, 5xx response, or malformed success never
 * double-submits because the first provider may already have spent credits.
 * Explicit engines remain available to the comparison lab without fallback.
 */
export async function generateBestMeshFromMultiview(
  shots: MultiviewShots,
  options: BuildFromPhotoOptions = {},
): Promise<string> {
  if (options.engine) {
    return generateMeshFromMultiview(shots, options);
  }
  try {
    return await generateMeshFromMultiview(shots, { ...options, engine: 'meshy' });
  } catch (error) {
    if (!(error instanceof GenerationSubmitError) || !error.definitivePreTaskRejection) {
      throw error;
    }
    options.onProgress?.(0.12, 'Meshy rejected before creating a task; trying Tripo');
    return generateMeshFromMultiview(shots, { ...options, engine: 'tripo' });
  }
}

/**
 * 360° path: 4 photos around the object → Meshy/Tripo multiview → GLB → bricks.
 * Real geometry from real photos on every side, instead of the AI
 * hallucinating whatever the single photo didn't show. Kept for the model
 * lab; the buyer path previews and approves the mesh before conversion.
 */
export async function buildFromMultiview(
  shots: MultiviewShots,
  options: BuildFromPhotoOptions = {},
): Promise<PhotoModels> {
  const meshUrl = await generateMeshFromMultiview(shots, options);
  options.onMeshUrl?.(meshUrl);
  options.onProgress?.(0.9, 'Converting to bricks');
  const models = await voxelizeGlbUrl(meshUrl, (fraction) =>
    options.onProgress?.(0.9 + fraction * 0.1, 'Converting to bricks'),
  );
  options.onProgress?.(1, 'Done');
  return {
    hasDepth: true,
    label: 'Your object',
    mode: 'volume',
    models,
    style: 'natural',
  };
}
