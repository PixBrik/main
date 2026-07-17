/**
 * Fidelity policy shared by mesh voxelization and the instant colour preview.
 *
 * The generated GLB is the approved source of truth.  Colour changes must not
 * rerun occupancy or rebuild slopes, otherwise selecting B&W can subtly change
 * the sculpture the buyer approved.  This module therefore keeps geometry and
 * colour as two deliberately separate operations.
 */

import type { PhotoModels } from './voxelizePhoto';
import { colorDistance, quantizeToCatalog } from './voxelizePhoto';
import type { VoxelCell, VoxelModel } from '../voxelFox';

/** Buyer-facing colour choices for generated 3D brick sculptures. */
export type MeshBrickColorStyle = 'natural' | 'bw';

/** Five opaque colours that are present in the current parts catalogue. */
export const MESH_BW_RAMP = ['#000000', '#646767', '#A0A19F', '#D9D9D6', '#FFFFFF'] as const;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function luma(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function coord(cell: Pick<VoxelCell, 'i' | 'j' | 'k'>): string {
  return `${cell.i}|${cell.j}|${cell.k}`;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

interface WeightedColor {
  color: Rgb;
  count: number;
}

/**
 * Collapse raw texture pixels into a bounded weighted histogram.  Texture
 * atlases often contain a few padding/seam pixels in unrelated colours; using
 * those pixels as equal-weight k-means seeds is what used to create green and
 * brown "camouflage" patches on otherwise natural models.
 */
function weightedHistogram(cells: VoxelCell[]): WeightedColor[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const cell of cells) {
    const [r, g, b] = hexToRgb(cell.colorHex ?? '#A0A19F');
    // Five bits per channel: enough texture fidelity for seed selection while
    // making a one-pixel atlas outlier insignificant.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key) ?? { b: 0, count: 0, g: 0, r: 0 };
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.count += 1;
    bins.set(key, bin);
  }
  return [...bins.values()]
    .map((bin) => ({
      color: [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count] as Rgb,
      count: bin.count,
    }))
    .sort((first, second) => {
      const lumaDelta = luma(first.color) - luma(second.color);
      if (lumaDelta) return lumaDelta;
      return first.color[0] - second.color[0] || first.color[1] - second.color[1] || first.color[2] - second.color[2];
    });
}

function nearestColorIndex(color: Rgb, centroids: Rgb[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centroids.length; index++) {
    const centroid = centroids[index]!;
    const distance = colorDistance(color[0], color[1], color[2], centroid[0], centroid[1], centroid[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function weightedQuantileIndex(colors: WeightedColor[], fraction: number): number {
  const total = colors.reduce((sum, entry) => sum + entry.count, 0);
  const target = total * fraction;
  let cumulative = 0;
  for (let index = 0; index < colors.length; index++) {
    cumulative += colors[index]!.count;
    if (cumulative >= target) return index;
  }
  return Math.max(0, colors.length - 1);
}

/**
 * Robust, deterministic texture palette.  Seeding is weighted by how often a
 * colour occurs instead of choosing the most exotic texel.  Dark/light
 * quantiles retain eyes and facial shading without promoting one atlas seam
 * into a whole catalogue colour.
 */
function naturalCentroids(cells: VoxelCell[]): Rgb[] {
  const histogram = weightedHistogram(cells);
  if (!histogram.length) return [[160, 161, 159]];

  const total = cells.length;
  const meaningfulThreshold = Math.max(2, Math.ceil(total * 0.001));
  const candidates = histogram.filter((entry) => entry.count >= meaningfulThreshold);
  const seedPool = candidates.length ? candidates : histogram;
  const meaningfulCatalogColors = new Set(
    seedPool
      .map((entry) => quantizeToCatalog(entry.color[0], entry.color[1], entry.color[2])),
  ).size;
  const targetK = Math.min(seedPool.length, Math.max(2, Math.min(10, meaningfulCatalogColors + 1)));

  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let weight = 0;
  for (const entry of histogram) {
    meanR += entry.color[0] * entry.count;
    meanG += entry.color[1] * entry.count;
    meanB += entry.color[2] * entry.count;
    weight += entry.count;
  }
  const mean: Rgb = [meanR / weight, meanG / weight, meanB / weight];
  const first = nearestColorIndex(mean, seedPool.map((entry) => entry.color));
  const seedIndices: number[] = [first];
  const addSeed = (index: number) => {
    if (!seedIndices.includes(index) && seedIndices.length < targetK) seedIndices.push(index);
  };
  addSeed(weightedQuantileIndex(seedPool, 0.03));
  addSeed(weightedQuantileIndex(seedPool, 0.97));

  const minDistances = new Float64Array(seedPool.length).fill(Number.POSITIVE_INFINITY);
  while (seedIndices.length < targetK) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < seedPool.length; index++) {
      const entry = seedPool[index]!;
      const latestSeed = seedPool[seedIndices[seedIndices.length - 1]!]!.color;
      const distance = colorDistance(
        entry.color[0], entry.color[1], entry.color[2],
        latestSeed[0], latestSeed[1], latestSeed[2],
      );
      minDistances[index] = Math.min(minDistances[index]!, distance);
      // A real but small feature can win; a single atlas-padding pixel cannot.
      const score = minDistances[index]! * Math.pow(entry.count, 0.45);
      if (!seedIndices.includes(index) && score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestScore <= 0) break;
    seedIndices.push(bestIndex);
  }

  let centroids = seedIndices.map((index) => [...seedPool[index]!.color] as Rgb);
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = Array.from({ length: centroids.length }, () => [0, 0, 0, 0]);
    for (const entry of histogram) {
      const cluster = nearestColorIndex(entry.color, centroids);
      const sum = sums[cluster]!;
      sum[0]! += entry.color[0] * entry.count;
      sum[1]! += entry.color[1] * entry.count;
      sum[2]! += entry.color[2] * entry.count;
      sum[3]! += entry.count;
    }
    centroids = centroids.map((old, index) => {
      const sum = sums[index]!;
      return sum[3]! > 0
        ? [sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!] as Rgb
        : old;
    });
  }
  return centroids;
}

function percentileStretch(hexes: string[]): { low: number; high: number } {
  const values = hexes.map((hex) => luma(hexToRgb(hex))).sort((a, b) => a - b);
  if (!values.length) return { high: 255, low: 0 };
  const low = values[Math.floor((values.length - 1) * 0.02)]!;
  const high = values[Math.ceil((values.length - 1) * 0.98)]!;
  // A genuinely uniform object should remain one coherent neutral rather than
  // have tiny compression noise stretched into black and white.
  return high - low < 24 ? { high: 255, low: 0 } : { high, low };
}

function bwMapper(hexes: string[]): (hex: string) => string {
  const { low, high } = percentileStretch(hexes);
  const span = Math.max(1, high - low);
  const cache = new Map<string, string>();
  return (hex: string) => {
    const cached = cache.get(hex);
    if (cached) return cached;
    const normalized = Math.max(0, Math.min(1, (luma(hexToRgb(hex)) - low) / span));
    const mapped = MESH_BW_RAMP[Math.round(normalized * (MESH_BW_RAMP.length - 1))]!;
    cache.set(hex, mapped);
    return mapped;
  };
}

/**
 * Apply catalogue-safe colour to raw voxel samples.  Only visible surface
 * colours train the natural palette; hidden filled interiors previously
 * sampled arbitrary nearest triangles and overwhelmed the visible texture.
 */
export function colorizeMeshCells(
  surfaceCells: VoxelCell[],
  interiorCells: VoxelCell[],
  style: MeshBrickColorStyle = 'natural',
): void {
  if (!surfaceCells.length) return;

  if (style === 'bw') {
    const map = bwMapper(surfaceCells.map((cell) => cell.colorHex ?? '#A0A19F'));
    for (const cell of surfaceCells) cell.colorHex = map(cell.colorHex ?? '#A0A19F');
    const interiorColor = dominantHex(surfaceCells);
    for (const cell of interiorCells) cell.colorHex = interiorColor;
    return;
  }

  const raw = surfaceCells.map((cell) => hexToRgb(cell.colorHex ?? '#A0A19F'));
  const centroids = naturalCentroids(surfaceCells);
  const assignments = new Int32Array(surfaceCells.length);
  for (let index = 0; index < surfaceCells.length; index++) {
    assignments[index] = nearestColorIndex(raw[index]!, centroids);
  }

  // Remove low-contrast hue speckles with a strict surface-neighbour vote.
  // High-contrast details (eyes, brows, logos) remain untouched.
  const byCoord = new Map(surfaceCells.map((cell, index) => [coord(cell), index]));
  const smoothed = new Int32Array(assignments);
  for (let index = 0; index < surfaceCells.length; index++) {
    const cell = surfaceCells[index]!;
    const votes = new Map<number, number>();
    for (const [di, dj, dk] of NEIGHBOURS) {
      const neighbour = byCoord.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
      if (neighbour === undefined) continue;
      const cluster = assignments[neighbour]!;
      votes.set(cluster, (votes.get(cluster) ?? 0) + 1);
    }
    let winner = assignments[index]!;
    let winnerVotes = 0;
    for (const [cluster, count] of votes) {
      if (count > winnerVotes) {
        winner = cluster;
        winnerVotes = count;
      }
    }
    if (winner === assignments[index] || winnerVotes < 4) continue;
    const ownLuma = luma(raw[index]!);
    const winnerLuma = luma(centroids[winner]!);
    if (Math.abs(ownLuma - winnerLuma) < 30) smoothed[index] = winner;
  }

  const catalogHex = centroids.map((centroid) =>
    quantizeToCatalog(centroid[0], centroid[1], centroid[2]),
  );
  for (let index = 0; index < surfaceCells.length; index++) {
    surfaceCells[index]!.colorHex = catalogHex[smoothed[index]!]!;
  }

  // Interior bricks cannot be seen in the approved preview.  Give them the
  // dominant visible colour so they do not add arbitrary/camouflage BOM lines.
  const interiorColor = dominantHex(surfaceCells);
  for (const cell of interiorCells) cell.colorHex = interiorColor;
}

function dominantHex(cells: VoxelCell[]): string {
  const counts = new Map<string, number>();
  let best = '#A0A19F';
  let bestCount = -1;
  for (const cell of cells) {
    const hex = cell.colorHex ?? '#A0A19F';
    const count = (counts.get(hex) ?? 0) + 1;
    counts.set(hex, count);
    if (count > bestCount || (count === bestCount && hex < best)) {
      best = hex;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pure colour-only model transform used by the result-screen preview.  Every
 * occupied cell and all shell metadata remain byte-for-byte equivalent apart
 * from `colorHex`, so toggling never changes the approved sculpture.
 */
export function recolorMeshModel(source: VoxelModel, style: MeshBrickColorStyle): VoxelModel {
  const sourceHexes = source.shell.map((cell) => cell.colorHex ?? '#A0A19F');
  const map = style === 'bw' ? bwMapper(sourceHexes) : (hex: string) => hex;
  const colors = new Map<string, string>();
  const cells = source.cells.map((cell) => {
    const colorHex = map(cell.colorHex ?? '#A0A19F');
    colors.set(coord(cell), colorHex);
    return { ...cell, colorHex };
  });
  const shell = source.shell.map((cell) => ({
    ...cell,
    colorHex: colors.get(coord(cell)) ?? map(cell.colorHex ?? '#A0A19F'),
    exposed: [...cell.exposed],
  }));
  return { ...source, cells, shell };
}

/** Cheap, lossless palette preview. Always pass the untouched natural build. */
export function recolorPhotoModels(source: PhotoModels, style: MeshBrickColorStyle): PhotoModels {
  return {
    ...source,
    models: {
      balanced: recolorMeshModel(source.models.balanced, style),
      detailed: recolorMeshModel(source.models.detailed, style),
      efficient: recolorMeshModel(source.models.efficient, style),
    },
    style: style === 'bw' ? 'classic' : 'natural',
  };
}
