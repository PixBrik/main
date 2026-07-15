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
import type { PhotoModels } from './voxelizePhoto';
import { voxelizeGlb, voxelizeGlbUrl, voxelizeGlbUrlOne } from './meshVoxelize';

/** Set `key` (and endpoint) to enable live photo→mesh generation. */
const MESH_API = {
  key: '',
  endpoint: 'https://api.example-image-to-3d.com/v1/generate',
};

export function isLive3DConfigured(): boolean {
  return MESH_API.key.length > 0;
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Live image-to-3D needs a hosted API key. Configure MESH_API to enable it.');
    this.name = 'NotConfiguredError';
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

/**
 * Live path: photo → hosted image-to-3D → GLB → bricks. Throws
 * NotConfiguredError until a key is set. The request/poll shape below matches
 * the common "submit job, poll status, download result" pattern used by
 * TripoSR-style hosts; adjust field names to the chosen provider.
 */
export async function buildFromPhoto(photoDataUrl: string): Promise<PhotoModels> {
  if (!isLive3DConfigured()) {
    throw new NotConfiguredError();
  }
  const submit = await fetch(MESH_API.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${MESH_API.key}` },
    body: JSON.stringify({ image: photoDataUrl, format: 'glb' }),
  });
  const job = (await submit.json()) as { id: string };

  // Poll until the mesh is ready.
  let resultUrl: string | null = null;
  for (let attempt = 0; attempt < 60 && !resultUrl; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await fetch(`${MESH_API.endpoint}/${job.id}`, {
      headers: { authorization: `Bearer ${MESH_API.key}` },
    });
    const body = (await status.json()) as { status: string; model_url?: string };
    if (body.status === 'completed' && body.model_url) {
      resultUrl = body.model_url;
    } else if (body.status === 'failed') {
      throw new Error('image-to-3D generation failed');
    }
  }
  if (!resultUrl) {
    throw new Error('image-to-3D timed out');
  }
  const buffer = await (await fetch(resultUrl)).arrayBuffer();
  return { hasDepth: true, label: 'Your object', mode: 'volume', models: await voxelizeGlb(buffer), style: 'natural' };
}
