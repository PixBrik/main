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

import { buildModelFromCells, type VoxelModel } from '../voxelFox';
import type { Segmentation } from './segment';
import type { PhotoModels } from './voxelizePhoto';
import { voxelizeGlbUrl, voxelizeGlbUrlOne } from './meshVoxelize';

/**
 * Live image-to-3D runs through Tripo via our own serverless proxy
 * (/api/tripo/*), so the API key stays server-side and never ships in the
 * browser bundle. This public flag only toggles whether the UI offers the
 * live path — the real secret is TRIPO_API_KEY on the server.
 */
export function isLive3DConfigured(): boolean {
  return (process.env.EXPO_PUBLIC_TRIPO_ENABLED ?? '') === '1';
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Live photo→3D is off. Set EXPO_PUBLIC_TRIPO_ENABLED=1 and TRIPO_API_KEY on the server.');
    this.name = 'NotConfiguredError';
  }
}

export class NoCreditError extends Error {
  constructor() {
    super('Tripo has no credit. Top up at platform.tripo3d.ai to generate models.');
    this.name = 'NoCreditError';
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
    label: 'Toy Car',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb',
    credit: 'Khronos glTF sample (CC0)',
  },
] as const;

/** Voxelize a mesh at a URL into a FotoBrik build. */
export async function buildFromMeshUrl(url: string, label: string): Promise<PhotoModels> {
  const models = await voxelizeGlbUrl(url);
  return { hasDepth: true, label, mode: 'volume', models, style: 'natural' };
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
  const cells = model.cells.map((cell) => ({
    ...cell,
    colorHex: tint(colorHex, 0.45 + 0.85 * hexLuminance(cell.colorHex ?? '#888888')),
  }));
  return buildModelFromCells(cells, model.size, { slopes: true });
}

/**
 * Library build: voxelize a catalogued mesh at one profile (fast) and, when a
 * colour is chosen, recolour it while preserving shading. Used by the object
 * library so users pick a model + colour instead of uploading a photo.
 */
export async function buildFromLibrary(url: string, label: string, colorHex?: string): Promise<PhotoModels> {
  const base = await voxelizeGlbUrlOne(url, 'efficient');
  const model = colorHex ? recolour(base, colorHex) : base;
  // Library builds reuse one voxelization across all profiles (already dense).
  return {
    hasDepth: true,
    label,
    mode: 'volume',
    models: { balanced: model, detailed: model, efficient: model },
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

/**
 * Crop to the object's region and punch out everything the segmentation
 * mask says is background, replacing it with a plain neutral backdrop.
 * Image-to-3D generation (Tripo) expects an isolated subject on a clean
 * background — like the product photography it's trained on — not a full
 * scene with an arbitrarily-cropped subject and a real wall behind it.
 * Reuses the segmentation the app already computed; no extra AI call.
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
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** Downscale any image src (data:/blob:/http) to a compact JPEG data URL so
 * the POST body stays under the serverless 4.5 MB limit. Web-only (canvas). */
async function toCompactDataUrl(src: string, max = 1024, quality = 0.85): Promise<string> {
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
  return canvas.toDataURL('image/jpeg', quality);
}

/** Report generation progress (0–1) while the model is being built. */
export type ProgressFn = (fraction: number, note: string) => void;

/**
 * Live path: photo → Tripo (via /api/tripo proxy) → GLB → bricks.
 * The key is held server-side; this only talks to our own origin.
 * Throws NotConfiguredError when the live path is off, NoCreditError when the
 * Tripo account is out of credit.
 */
export async function buildFromPhoto(
  photoSrc: string,
  segmentation?: Segmentation | null,
  onProgress?: ProgressFn,
): Promise<PhotoModels> {
  if (!isLive3DConfigured()) {
    throw new NotConfiguredError();
  }
  onProgress?.(0.05, 'Preparing photo');
  // Send Tripo the isolated object (cropped + background removed) whenever
  // we already have a segmentation for this photo, not the full raw scene.
  const cutout = segmentation ? await compositeCutout(photoSrc, segmentation).catch(() => photoSrc) : photoSrc;
  const image = await toCompactDataUrl(cutout);

  onProgress?.(0.12, 'Uploading to generator');
  const submit = await fetch('/api/tripo/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  });
  if (!submit.ok) {
    if (submit.status === 402) {
      throw new NoCreditError();
    }
    const body = (await submit.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `generation could not start (${submit.status})`);
  }
  const { taskId } = (await submit.json()) as { taskId: string };

  // Poll our status proxy until the mesh is ready (Tripo takes ~30s–2min).
  let ready = false;
  for (let attempt = 0; attempt < 90 && !ready; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const statusRes = await fetch(`/api/tripo/status?taskId=${encodeURIComponent(taskId)}`);
    if (!statusRes.ok) {
      continue;
    }
    const body = (await statusRes.json()) as { status: string; progress?: number; hasModel?: boolean };
    if (body.status === 'success' && body.hasModel) {
      ready = true;
    } else if (['failed', 'cancelled', 'banned', 'expired'].includes(body.status)) {
      throw new Error(`generation ${body.status}`);
    } else {
      // Map Tripo's 0–100 progress into the 0.15–0.9 band.
      onProgress?.(0.15 + 0.75 * ((body.progress ?? 0) / 100), 'Sculpting 3D model');
    }
  }
  if (!ready) {
    throw new Error('generation timed out');
  }

  onProgress?.(0.92, 'Converting to bricks');
  // Voxelize once at the lightest profile and reuse it. Generated meshes are
  // capped at ~10k faces server-side (face_limit), but the voxelizer still runs
  // synchronously on the main thread, so 'efficient' (res 28) keeps it from
  // freezing the tab. Voxelizing all three profiles (incl. res-64) would hang.
  const model = await voxelizeGlbUrlOne(`/api/tripo/model?taskId=${encodeURIComponent(taskId)}`, 'efficient');
  onProgress?.(1, 'Done');
  return {
    hasDepth: true,
    label: 'Your object',
    mode: 'volume',
    models: { balanced: model, detailed: model, efficient: model },
    style: 'natural',
  };
}
