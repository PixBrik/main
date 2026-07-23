import type { VoxelModel } from '../voxelFox';
import type { MeshBrickColorStyle } from './meshFidelity';

/**
 * Native stub. Mesh voxelization is web-first (see meshVoxelize.web.ts) — it
 * needs three.js + WebGL. Native builds fall back to the photo pipeline.
 */

export type MeshProfile = 'efficient' | 'balanced' | 'detailed';
export type VoxelizeProgressFn = (fraction: number) => void;
export interface MeshVoxelizeOptions {
  colorStyle?: MeshBrickColorStyle;
  studSpans?: Partial<Record<MeshProfile, number>>;
  /** Web engine: `nearest` (closest surface) or `skin` (first surface seen from outside). */
  colourSampling?: 'nearest' | 'skin';
}

export async function voxelizeGlb(
  _buffer: ArrayBuffer,
  _onProgress?: VoxelizeProgressFn,
  _options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  throw new Error('mesh voxelization is web-only');
}

export async function voxelizeGlbUrl(
  _url: string,
  _onProgress?: VoxelizeProgressFn,
  _options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  throw new Error('mesh voxelization is web-only');
}

export async function voxelizeGlbUrlOne(
  _url: string,
  _profile: MeshProfile,
  _onProgress?: VoxelizeProgressFn,
  _options: MeshVoxelizeOptions = {},
): Promise<VoxelModel> {
  throw new Error('mesh voxelization is web-only');
}

export interface ComposedPart {
  url: string;
  scale?: number;
  x?: number;
  z?: number;
  lift?: number;
  leanDirectionDeg?: number;
  leanDeg?: number;
  spinDeg?: number;
}

export async function voxelizeComposedUrl(
  _parts: ComposedPart[],
  _onProgress?: VoxelizeProgressFn,
  _options?: MeshVoxelizeOptions,
): Promise<Record<MeshProfile, VoxelModel>> {
  throw new Error('mesh voxelization is web-only');
}

export async function voxelizeComposedUrlOne(
  _parts: ComposedPart[],
  _profile: MeshProfile,
  _onProgress?: VoxelizeProgressFn,
  _options?: MeshVoxelizeOptions,
): Promise<VoxelModel> {
  throw new Error('mesh voxelization is web-only');
}

export const isMeshVoxelizeSupported = false;
