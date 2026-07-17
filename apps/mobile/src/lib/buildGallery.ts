/**
 * Previous-builds gallery: persists finished models locally (web
 * localStorage; silently unavailable elsewhere) so earlier renderings can
 * be reopened, re-inspected, re-priced, and re-exported.
 */

import { buildModelFromCells, type VoxelCell, type VoxelModel } from './voxelFox';
import { voxelBaseColor } from './voxelRender';
import type { PanelStyle, PhotoBuildMode } from './photoEngine/voxelizePhoto';

export type SavedBuildProduct = 'panel' | 'sculpture';
export type SavedBuildProvenance = 'flat-photo' | 'provider-3d' | 'library';

export interface SavedBuildMetadata {
  hasDepth: boolean;
  mode: PhotoBuildMode;
  product: SavedBuildProduct;
  provenance: SavedBuildProvenance;
  style: PanelStyle;
}

export interface SavedBuild {
  id: string;
  name: string;
  savedAt: string;
  brickCount: number;
  size: number;
  palette: string[];
  /** Missing on legacy entries; unknown builds must never be claimed as provider 3D. */
  hasDepth?: boolean;
  mode?: PhotoBuildMode;
  product?: SavedBuildProduct;
  provenance?: SavedBuildProvenance;
  style?: PanelStyle;
  /** [i, j, k, paletteIndex] per cell — compact enough for localStorage. */
  cells: number[][];
}

const STORAGE_KEY = 'fotobrik.builds.v1';
const MAX_BUILDS = 5;

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Blocked or unavailable.
  }
  return null;
}

export function listBuilds(): SavedBuild[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedBuild[]) : [];
  } catch {
    return [];
  }
}

export function saveBuild(
  name: string,
  model: VoxelModel,
  accent: string,
  metadata: SavedBuildMetadata,
): SavedBuild | null {
  const store = storage();
  if (!store) return null;

  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  const cells = model.cells.map((cell) => {
    const hex = cell.colorHex ?? voxelBaseColor({ ...cell, exposed: [] }, accent);
    let index = paletteIndex.get(hex);
    if (index === undefined) {
      index = palette.length;
      palette.push(hex);
      paletteIndex.set(hex, index);
    }
    return [cell.i, cell.j, cell.k, index];
  });

  const build: SavedBuild = {
    brickCount: model.brickCount,
    cells,
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    palette,
    ...metadata,
    savedAt: new Date().toISOString(),
    size: model.size,
  };

  try {
    const builds = [build, ...listBuilds()].slice(0, MAX_BUILDS);
    store.setItem(STORAGE_KEY, JSON.stringify(builds));
    return build;
  } catch {
    return null;
  }
}

export function loadModel(build: SavedBuild): VoxelModel {
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, minK = Infinity, maxK = -Infinity;
  for (const [i, j, k] of build.cells) {
    minI = Math.min(minI, i!);
    maxI = Math.max(maxI, i!);
    minJ = Math.min(minJ, j!);
    minK = Math.min(minK, k!);
    maxK = Math.max(maxK, k!);
  }
  const centerI = (minI + maxI) / 2;
  const centerK = (minK + maxK) / 2;

  const cells: VoxelCell[] = build.cells.map(([i, j, k, paletteIdx]) => ({
    colorHex: build.palette[paletteIdx!] ?? '#E96632',
    cx: (i! - centerI) * build.size,
    cy: (j! - minJ + 0.5) * build.size,
    cz: (k! - centerK) * build.size,
    i: i!,
    j: j!,
    k: k!,
    zone: 'body',
  }));
  return buildModelFromCells(cells, build.size);
}

export function deleteBuild(id: string) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(listBuilds().filter((build) => build.id !== id)));
  } catch {
    // Ignore.
  }
}

/** Rename a saved build (e.g. the one just created). Returns success. */
export function renameBuild(id: string, name: string): boolean {
  const store = storage();
  if (!store) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  try {
    const builds = listBuilds().map((build) => (build.id === id ? { ...build, name: trimmed } : build));
    store.setItem(STORAGE_KEY, JSON.stringify(builds));
    return true;
  } catch {
    return false;
  }
}

/** The most recently saved build, if any. */
export function latestBuild(): SavedBuild | null {
  return listBuilds()[0] ?? null;
}
