import type { VoxelModel } from '../voxelFox';

/**
 * Native stub. Mesh voxelization is web-first (see meshVoxelize.web.ts) — it
 * needs three.js + WebGL. Native builds fall back to the photo pipeline.
 */

export type MeshProfile = 'efficient' | 'balanced' | 'detailed';
export type VoxelizeProgressFn = (fraction: number) => void;

export async function voxelizeGlb(
  _buffer: ArrayBuffer,
  _onProgress?: VoxelizeProgressFn,
): Promise<Record<MeshProfile, VoxelModel>> {
  throw new Error('mesh voxelization is web-only');
}

export async function voxelizeGlbUrl(
  _url: string,
  _onProgress?: VoxelizeProgressFn,
): Promise<Record<MeshProfile, VoxelModel>> {
  throw new Error('mesh voxelization is web-only');
}

export async function voxelizeGlbUrlOne(
  _url: string,
  _profile: MeshProfile,
  _onProgress?: VoxelizeProgressFn,
): Promise<VoxelModel> {
  throw new Error('mesh voxelization is web-only');
}

export const isMeshVoxelizeSupported = false;
