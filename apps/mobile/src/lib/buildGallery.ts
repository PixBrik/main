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
export type SavedBuildSubject = 'object' | 'person';

export interface SavedBuildMetadata {
  hasDepth: boolean;
  mode: PhotoBuildMode;
  product: SavedBuildProduct;
  provenance: SavedBuildProvenance;
  style: PanelStyle;
  /** Linked reference to the approved source GLB when this is a true 3D build. */
  source3DMeshUrl?: string;
  source3DRetakesRemaining?: number;
  source3DSubject?: SavedBuildSubject;
}

export interface SavedBuild {
  id: string;
  name: string;
  savedAt: string;
  brickCount: number;
  size: number;
  layerHeight?: number;
  palette: string[];
  /** Missing on legacy entries; unknown builds must never be claimed as provider 3D. */
  hasDepth?: boolean;
  mode?: PhotoBuildMode;
  product?: SavedBuildProduct;
  provenance?: SavedBuildProvenance;
  style?: PanelStyle;
  source3DMeshUrl?: string;
  source3DRetakesRemaining?: number;
  source3DSubject?: SavedBuildSubject;
  /** [i, j, k, paletteIndex, slopeFlag, facing] per cell — compact enough for localStorage. */
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

function serializeBuild(
  id: string,
  name: string,
  model: VoxelModel,
  accent: string,
  metadata: SavedBuildMetadata,
): SavedBuild {
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
    return [cell.i, cell.j, cell.k, index, cell.shape === 'slope' ? 1 : 0, cell.facing ?? 0];
  });

  return {
    brickCount: model.brickCount,
    cells,
    id,
    name,
    palette,
    ...(model.layerHeight ? { layerHeight: model.layerHeight } : {}),
    ...metadata,
    savedAt: new Date().toISOString(),
    size: model.size,
  };
}

export function saveBuild(
  name: string,
  model: VoxelModel,
  accent: string,
  metadata: SavedBuildMetadata,
): SavedBuild | null {
  const store = storage();
  if (!store) return null;
  const build = serializeBuild(
    `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    model,
    accent,
    metadata,
  );

  try {
    const builds = [build, ...listBuilds()].slice(0, MAX_BUILDS);
    store.setItem(STORAGE_KEY, JSON.stringify(builds));
    return build;
  } catch {
    return null;
  }
}

/** Replace one in-progress gallery build without creating style/background duplicates. */
export function updateBuild(
  id: string,
  name: string,
  model: VoxelModel,
  accent: string,
  metadata: SavedBuildMetadata,
): SavedBuild | null {
  const store = storage();
  if (!store) return null;
  const current = listBuilds();
  if (!current.some((build) => build.id === id)) {
    return saveBuild(name, model, accent, metadata);
  }
  const replacement = serializeBuild(id, name, model, accent, metadata);
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify([replacement, ...current.filter((build) => build.id !== id)].slice(0, MAX_BUILDS)),
    );
    return replacement;
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

  const hasStoredGeometry = build.cells.some((cell) => cell.length >= 5);
  const layerHeight = build.layerHeight ?? build.size;
  const cells: VoxelCell[] = build.cells.map(([i, j, k, paletteIdx, slopeFlag, facing]) => ({
    colorHex: build.palette[paletteIdx!] ?? '#E96632',
    cx: (i! - centerI) * build.size,
    cy: (j! - minJ + 0.5) * layerHeight,
    cz: (k! - centerK) * build.size,
    i: i!,
    j: j!,
    k: k!,
    ...(slopeFlag === 1 ? { shape: 'slope' as const } : {}),
    ...(facing ? { facing } : {}),
    zone: 'body',
  }));
  return buildModelFromCells(cells, build.size, {
    layerHeight: build.layerHeight,
    preserveShapes: hasStoredGeometry,
  });
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
