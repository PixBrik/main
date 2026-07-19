/**
 * Bouquet composer: arrange N instances of a photoreal flower master —
 * optionally standing in a vase master — into ONE composed scene, then
 * voxelize it like any other library mesh. The output is a normal
 * PhotoModels, so sizes, hollow pricing, BOM and instruction guides all
 * flow through unchanged.
 *
 * Layouts are deterministic tables (no randomness — same choices, same
 * kit). All coordinates live in the composer's normalized frame: every
 * master is scaled to a 1-unit longest axis first, so flower and vase
 * scans of wildly different real-world sizes compose correctly.
 */

import type { PhotoModels } from './voxelizePhoto';
import { voxelizeComposedUrl, type ComposedPart } from './meshVoxelize';
import type { LibraryEntry } from '../../data/carLibrary';

export interface BouquetVaseOption {
  id: string;
  name: string;
  /** null = no vase (hand-tied bouquet). */
  url: string | null;
}

export interface BouquetSpec {
  vases: ReadonlyArray<BouquetVaseOption>;
}

export type BouquetCount = 1 | 3 | 5;

/** Per-count flower placements WITHOUT a vase (hand-tied, standing). */
const FREE_LAYOUTS: Record<BouquetCount, ComposedPart[]> = {
  1: [{ leanDeg: 6, leanDirectionDeg: 30, url: '' }],
  3: [
    { leanDeg: 12, leanDirectionDeg: 0, spinDeg: 0, url: '', x: 0.16, z: 0 },
    { leanDeg: 12, leanDirectionDeg: 130, spinDeg: 120, url: '', x: -0.1, z: 0.13 },
    { leanDeg: 12, leanDirectionDeg: 245, spinDeg: 240, url: '', x: -0.1, z: -0.13 },
  ],
  5: [
    { leanDeg: 4, leanDirectionDeg: 0, spinDeg: 60, url: '' },
    { leanDeg: 16, leanDirectionDeg: 10, spinDeg: 0, url: '', x: 0.22, z: 0.04 },
    { leanDeg: 16, leanDirectionDeg: 100, spinDeg: 90, url: '', x: -0.03, z: 0.22 },
    { leanDeg: 16, leanDirectionDeg: 190, spinDeg: 180, url: '', x: -0.22, z: -0.02 },
    { leanDeg: 16, leanDirectionDeg: 280, spinDeg: 270, url: '', x: 0.02, z: -0.22 },
  ],
};

/**
 * With a vase: the vase stands at the origin (scaled down so the flowers
 * dominate), and flower bases sink to just below the vase mouth so stems
 * read as standing IN it, fanning outward.
 */
const VASE_SCALE = 0.55;
const VASE_MOUTH_LIFT = 0.34;

const VASE_LAYOUTS: Record<BouquetCount, ComposedPart[]> = {
  1: [{ leanDeg: 7, leanDirectionDeg: 40, lift: VASE_MOUTH_LIFT, url: '' }],
  3: [
    { leanDeg: 14, leanDirectionDeg: 0, lift: VASE_MOUTH_LIFT, spinDeg: 0, url: '', x: 0.1 },
    { leanDeg: 14, leanDirectionDeg: 130, lift: VASE_MOUTH_LIFT, spinDeg: 120, url: '', x: -0.06, z: 0.08 },
    { leanDeg: 14, leanDirectionDeg: 245, lift: VASE_MOUTH_LIFT, spinDeg: 240, url: '', x: -0.06, z: -0.08 },
  ],
  5: [
    { leanDeg: 5, leanDirectionDeg: 0, lift: VASE_MOUTH_LIFT + 0.04, spinDeg: 45, url: '' },
    { leanDeg: 20, leanDirectionDeg: 15, lift: VASE_MOUTH_LIFT, spinDeg: 0, url: '', x: 0.12, z: 0.02 },
    { leanDeg: 20, leanDirectionDeg: 105, lift: VASE_MOUTH_LIFT, spinDeg: 90, url: '', x: -0.02, z: 0.12 },
    { leanDeg: 20, leanDirectionDeg: 195, lift: VASE_MOUTH_LIFT, spinDeg: 180, url: '', x: -0.12, z: -0.01 },
    { leanDeg: 20, leanDirectionDeg: 285, lift: VASE_MOUTH_LIFT, spinDeg: 270, url: '', x: 0.01, z: -0.12 },
  ],
};

export function composeBouquetParts(
  flowerUrl: string,
  count: BouquetCount,
  vaseUrl: string | null,
): ComposedPart[] {
  const layout = vaseUrl ? VASE_LAYOUTS[count] : FREE_LAYOUTS[count];
  const parts: ComposedPart[] = layout.map((slot) => ({ ...slot, url: flowerUrl }));
  if (vaseUrl) {
    parts.unshift({ scale: VASE_SCALE, url: vaseUrl });
  }
  return parts;
}

/** Resolve the buyer's vase choice against the entry's declared options. */
export function resolveVaseUrl(entry: LibraryEntry, vaseId: string | undefined): string | null {
  const options = entry.bouquet?.vases ?? [];
  const chosen = options.find((option) => option.id === vaseId) ?? options[0];
  return chosen?.url ?? null;
}

/**
 * Build a composed bouquet at all three profiles — the composed analogue of
 * buildFromLibrary(). Colours stay natural: these are photoreal scans, and
 * hue-shifting a whole flower would recolour its leaves too.
 */
export async function buildBouquetFromLibrary(
  entry: LibraryEntry,
  count: BouquetCount,
  vaseId: string | undefined,
  onProgress?: (fraction: number) => void,
): Promise<PhotoModels> {
  if (!entry.meshUrl) throw new Error('bouquet entry has no flower master');
  const parts = composeBouquetParts(entry.meshUrl, count, resolveVaseUrl(entry, vaseId));
  const models = await voxelizeComposedUrl(parts, onProgress);
  return {
    hasDepth: true,
    label: entry.name,
    mode: 'volume',
    models,
    style: 'natural',
  };
}
