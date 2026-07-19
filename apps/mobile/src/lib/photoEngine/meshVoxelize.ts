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

export const isMeshVoxelizeSupported = false;
