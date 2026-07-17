/**
 * Procedural voxel interpretation of the demo fox.
 *
 * The object is described as a set of solid primitives (ellipsoids, boxes,
 * a swept tail curve) and sampled onto a cubic grid whose resolution depends
 * on the build profile. Interior faces between adjacent voxels are culled at
 * build time, so the renderer only ever draws the exposed shell.
 */

export type BuildProfile = 'efficient' | 'balanced' | 'detailed';

/** Standard brick height (9.6 mm) divided by horizontal stud pitch (8 mm). */
export const BRICK_HEIGHT_RATIO = 1.2;

export type VoxelZone = 'body' | 'cream' | 'dark' | 'mint' | 'accent';

export interface Voxel {
  /** Centre of the voxel in model units. */
  cx: number;
  cy: number;
  cz: number;
  /** Integer grid coordinates (stable across renders, used for colour jitter). */
  i: number;
  j: number;
  k: number;
  zone: VoxelZone;
  /** Explicit colour (photo-derived models); overrides the zone colour. */
  colorHex?: string;
  /** 'slope' renders as a 45° wedge and packs as a real slope part. */
  shape?: 'slope';
  /** Descent direction of a slope — index into FACE_DIRECTIONS (1..4). */
  facing?: number;
  /** Which of the five renderable faces are exposed, indexed like FACE_DIRECTIONS. */
  exposed: boolean[];
}

export interface VoxelCell {
  i: number;
  j: number;
  k: number;
  zone: VoxelZone;
  colorHex?: string;
  shape?: 'slope';
  facing?: number;
  cx: number;
  cy: number;
  cz: number;
}

function sameColour(a: VoxelCell, b: VoxelCell) {
  return a.zone === b.zone && (a.colorHex ?? '') === (b.colorHex ?? '');
}

/**
 * Convert single-step staircases into 45° slopes. A cell slopes toward
 * direction d when nothing sits above it, the cell ahead is empty but the
 * cell ahead-below is filled (a step down), and the same-coloured cell
 * behind it exists — because the real slope part (3040 family) occupies the
 * slope cell AND its back cell in one piece.
 */
function detectSlopes(index: Map<string, VoxelCell>) {
  const horizontal = [1, 2, 3, 4] as const;
  for (const cell of index.values()) {
    if (index.has(`${cell.i}|${cell.j + 1}|${cell.k}`)) continue;

    let match: number | null = null;
    for (const face of horizontal) {
      const dir = FACE_DIRECTIONS[face]!;
      const ahead = index.get(`${cell.i + dir.x}|${cell.j}|${cell.k + dir.z}`);
      const aheadBelow = index.get(`${cell.i + dir.x}|${cell.j - 1}|${cell.k + dir.z}`);
      const behind = index.get(`${cell.i - dir.x}|${cell.j}|${cell.k - dir.z}`);
      if (!ahead && aheadBelow && behind && sameColour(behind, cell)) {
        if (match !== null) {
          match = null; // ambiguous corner — keep the cube
          break;
        }
        match = face;
      }
    }
    if (match !== null) {
      cell.shape = 'slope';
      cell.facing = match;
    }
  }
}

export interface BuildModelOptions {
  /** Convert staircase steps into 45° slopes (default true). */
  slopes?: boolean;
  /** Keep shape/facing metadata already approved on the supplied cells. */
  preserveShapes?: boolean;
  /** Physical vertical pitch; defaults to `size` for square photo grids. */
  layerHeight?: number;
}

/**
 * Assemble a renderable model from explicit cells: culls every face shared
 * between two cells and drops fully-enclosed interior cells from the shell.
 */
export function buildModelFromCells(
  cells: VoxelCell[],
  size: number,
  options: BuildModelOptions = {},
): VoxelModel {
  const index = new Map<string, VoxelCell>();
  for (const cell of cells) {
    if (!options.preserveShapes) {
      cell.shape = undefined;
      cell.facing = undefined;
    }
    index.set(`${cell.i}|${cell.j}|${cell.k}`, cell);
  }

  if (!options.preserveShapes && options.slopes !== false) {
    detectSlopes(index);
  }

  const shell: Voxel[] = [];
  let exposedFaceCount = 0;

  for (const cell of index.values()) {
    const exposed = FACE_DIRECTIONS.map(
      (direction) => !index.has(`${cell.i + direction.x}|${cell.j + direction.y}|${cell.k + direction.z}`),
    );
    const exposedCount = exposed.filter(Boolean).length;
    if (exposedCount === 0) {
      continue;
    }
    exposedFaceCount += exposedCount;
    shell.push({ ...cell, exposed });
  }

  return {
    brickCount: index.size,
    cells: [...index.values()],
    exposedFaceCount,
    ...(options.layerHeight ? { layerHeight: options.layerHeight } : {}),
    shell,
    size,
  };
}

export interface VoxelModel {
  size: number;
  /** Vertical layer pitch when it differs from horizontal stud pitch. */
  layerHeight?: number;
  brickCount: number;
  exposedFaceCount: number;
  /** Only voxels with at least one exposed face — interior bricks never render. */
  shell: Voxel[];
  /** Every cell including interiors — used for part packing and the BOM. */
  cells: VoxelCell[];
}

/** Order matters: it must match the face definitions in the renderer. */
export const FACE_DIRECTIONS = [
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
] as const;

const VOXEL_SIZE_BY_PROFILE: Record<BuildProfile, number> = {
  efficient: 0.46,
  balanced: 0.34,
  detailed: 0.27,
};

const BOUNDS = { minX: -2.6, maxX: 4.3, minY: 0, maxY: 6.9, minZ: -1.4, maxZ: 1.9 } as const;

function insideEllipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const dz = (z - cz) / rz;
  return dx * dx + dy * dy + dz * dz <= 1;
}

function classify(x: number, y: number, z: number): VoxelZone | null {
  // Ears: tapering triangular prisms, dark tips.
  if (y >= 5.15 && y <= 6.7) {
    const t = (y - 5.15) / 1.55;
    const halfWidth = 0.62 * (1 - t) + 0.1;
    for (const side of [-1, 1]) {
      if (Math.abs(x - side * 0.85) <= halfWidth && Math.abs(z + 0.02) <= halfWidth + 0.12) {
        return t > 0.68 ? 'dark' : 'body';
      }
    }
  }

  // Head with mint sensor eyes.
  if (insideEllipsoid(x, y, z, 0, 4.45, 0.08, 1.32, 1.02, 1.02)) {
    for (const side of [-1, 1]) {
      const dx = x - side * 0.55;
      const dy = y - 4.72;
      const dz = z - 0.92;
      if (dx * dx + dy * dy + dz * dz <= 0.05) {
        return 'mint';
      }
    }
    return 'body';
  }

  // Muzzle with dark nose.
  if (insideEllipsoid(x, y, z, 0, 4.02, 1.2, 0.7, 0.48, 0.62)) {
    const dy = y - 4.1;
    const dz = z - 1.62;
    if (x * x + dy * dy + dz * dz <= 0.045) {
      return 'dark';
    }
    return 'cream';
  }

  if (insideEllipsoid(x, y, z, 0, 3.4, 0.05, 1.02, 0.72, 0.88)) {
    return 'body';
  }

  // Torso: accent chest patch, cream belly.
  if (insideEllipsoid(x, y, z, 0, 2.15, 0, 1.78, 1.38, 1.15)) {
    if (z > 0.5 && Math.abs(x) < 0.72 && y > 1.35 && y < 3.05) {
      return 'accent';
    }
    if (y < 1.3) {
      return 'cream';
    }
    return 'body';
  }

  // Legs with dark paws.
  for (const side of [-1, 1]) {
    for (const front of [0.68, -0.6]) {
      if (Math.abs(x - side * 0.95) <= 0.37 && Math.abs(z - front) <= 0.37 && y >= 0 && y <= 1.7) {
        return y < 0.42 ? 'dark' : 'body';
      }
    }
  }

  // Tail: chain of spheres along a rising curve, cream tip.
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const cx = 1.55 + 2.25 * t;
    const cy = 2.05 + 1.35 * t * t;
    const radius = 0.68 - 0.18 * t;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z + 0.35;
    if (dx * dx + dy * dy + dz * dz <= radius * radius) {
      return t > 0.72 ? 'cream' : 'body';
    }
  }

  return null;
}

export interface VoxelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Sample any solid described by a classifier onto a cubic grid and cull
 * every face shared between two bricks. Reused by all demo objects.
 */
export function voxelize(
  classifier: (x: number, y: number, z: number) => VoxelZone | null,
  size: number,
  bounds: VoxelBounds,
): VoxelModel {
  const cells: VoxelCell[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x += size) {
    for (let y = bounds.minY; y <= bounds.maxY; y += size) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += size) {
        const zone = classifier(x + size / 2, y + size / 2, z + size / 2);
        if (zone) {
          const i = Math.round(x / size);
          const j = Math.round(y / size);
          const k = Math.round(z / size);
          cells.push({
            cx: i * size + size / 2,
            cy: j * size + size / 2,
            cz: k * size + size / 2,
            i,
            j,
            k,
            zone,
          });
        }
      }
    }
  }

  return buildModelFromCells(cells, size);
}

const modelCache = new Map<BuildProfile, VoxelModel>();

export function getVoxelModel(profile: BuildProfile): VoxelModel {
  const cached = modelCache.get(profile);
  if (cached) {
    return cached;
  }

  const model = voxelize(classify, VOXEL_SIZE_BY_PROFILE[profile], BOUNDS);
  modelCache.set(profile, model);
  return model;
}
