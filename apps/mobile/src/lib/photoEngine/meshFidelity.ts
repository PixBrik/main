/**
 * Fidelity policy shared by mesh voxelization and the instant colour preview.
 *
 * The generated GLB is the approved source of truth.  Colour changes must not
 * rerun occupancy or rebuild slopes, otherwise selecting B&W can subtly change
 * the sculpture the buyer approved.  This module therefore keeps geometry and
 * colour as two deliberately separate operations.
 */

import type { PhotoModels } from './voxelizePhoto';
import { colorDistance, getPalette, quantizeToCatalog } from './voxelizePhoto';
import type { VoxelCell, VoxelModel } from '../voxelFox';

/**
 * Buyer-facing colour choices for generated 3D brick sculptures. `portrait`
 * keeps natural colour but smooths far more aggressively: photogrammetry
 * scans bake lighting into their textures, and without it that shading
 * quantises into single-brick speckle across a face.
 */
export type MeshBrickColorStyle = 'natural' | 'bw' | 'portrait';

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
function naturalCentroids(cells: VoxelCell[], maxK = 10): Rgb[] {
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
  const targetK = Math.min(seedPool.length, Math.max(2, Math.min(maxK, meaningfulCatalogColors + 1)));

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
  let portraitLocked: Uint8Array | null = null;

  // Baked specular: AI/scan textures carry white highlight patches that are
  // LIGHTING, not colour. Per-cell tests only erode patch edges, so work at
  // REGION level: flood bright/desaturated samples into patches; a patch
  // whose border is majority saturated-and-darker is a highlight sitting on
  // a coloured surface — recolour the whole patch from its border, kept
  // slightly lighter so shading still reads. Big genuine light regions
  // (white collar, grey statue) have same-toned borders and survive.
  {
    const byCoordSpec = new Map(surfaceCells.map((cell, index) => [coord(cell), index]));
    const isBrightDesat = (colour: Rgb): boolean => {
      const lumaOf = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
      const sat = Math.max(colour[0], colour[1], colour[2]) - Math.min(colour[0], colour[1], colour[2]);
      return lumaOf >= 170 && sat <= 75;
    };
    const NEIGHBOURS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    const visited = new Uint8Array(surfaceCells.length);
    for (let seedIndex = 0; seedIndex < surfaceCells.length; seedIndex++) {
      if (visited[seedIndex] || !isBrightDesat(raw[seedIndex]!)) continue;
      const patch: number[] = [];
      const stack = [seedIndex];
      visited[seedIndex] = 1;
      while (stack.length) {
        const index = stack.pop()!;
        patch.push(index);
        const cell = surfaceCells[index]!;
        for (const [di, dj, dk] of NEIGHBOURS6) {
          const neighbour = byCoordSpec.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
          if (neighbour === undefined || visited[neighbour]) continue;
          if (!isBrightDesat(raw[neighbour]!)) continue;
          visited[neighbour] = 1;
          stack.push(neighbour);
        }
      }
      if (patch.length > 400) continue; // that's a surface, not a highlight
      let border = 0;
      let saturatedDarker = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      const inPatch = new Set(patch);
      for (const index of patch) {
        const cell = surfaceCells[index]!;
        for (const [di, dj, dk] of NEIGHBOURS6) {
          const neighbour = byCoordSpec.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
          if (neighbour === undefined || inPatch.has(neighbour)) continue;
          border += 1;
          const colour = raw[neighbour]!;
          const nSat = Math.max(colour[0], colour[1], colour[2]) - Math.min(colour[0], colour[1], colour[2]);
          const nLuma = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
          if (nSat >= 55 && nLuma <= 165) {
            saturatedDarker += 1;
            r += colour[0];
            g += colour[1];
            b += colour[2];
          }
        }
      }
      if (border === 0 || saturatedDarker / border < 0.6) continue;
      const healed: Rgb = [
        Math.min(255, (r / saturatedDarker) * 1.22),
        Math.min(255, (g / saturatedDarker) * 1.22),
        Math.min(255, (b / saturatedDarker) * 1.22),
      ];
      const healedHex = `#${healed.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
      for (const index of patch) {
        raw[index] = healed;
        // Centroid derivation reads colorHex, not raw — heal both.
        surfaceCells[index]!.colorHex = healedHex;
      }
    }
  }

  // Portrait style opens with a spatial blur of the raw samples. Scan
  // textures carry baked-in shading at brick-level frequency; the neighbour
  // vote below can only heal single-cell outliers, while this heals the
  // region-scale mottling that otherwise quantises into camouflage patches.
  // Radius 2 keeps genuine features (eyes, brows, lips) — they are broader
  // and darker than the noise.
  if (style === 'portrait') {
    const byCoordRaw = new Map(surfaceCells.map((cell, index) => [coord(cell), index]));
    const blurred: Rgb[] = raw.map(() => [0, 0, 0]);
    const locked = new Uint8Array(surfaceCells.length);
    for (let index = 0; index < surfaceCells.length; index++) {
      const cell = surfaceCells[index]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          for (let dk = -2; dk <= 2; dk++) {
            const neighbour = byCoordRaw.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
            if (neighbour === undefined) continue;
            const w = 1 / (1 + Math.abs(di) + Math.abs(dj) + Math.abs(dk));
            const colour = raw[neighbour]!;
            r += colour[0] * w;
            g += colour[1] * w;
            b += colour[2] * w;
            weight += w;
          }
        }
      }
      blurred[index] = weight > 0 ? [r / weight, g / weight, b / weight] : raw[index]!;
      // Detail lock: a face is not just skin — brows, eyes and lips are
      // SMALL regions that differ sharply from their surroundings, exactly
      // what an anti-speckle blur would erase. Cells whose own colour stands
      // far from the local mean keep their original sample and are exempt
      // from vote flips, so features survive while shading still smooths.
      const own = raw[index]!;
      const mean = blurred[index]!;
      const dr = own[0] - mean[0];
      const dg = own[1] - mean[1];
      const db = own[2] - mean[2];
      if (2 * dr * dr + 4 * dg * dg + 3 * db * db > 5200) locked[index] = 1;
    }
    // A genuine feature (brow, lip, eye) is never one cell alone — it has at
    // least one neighbour of similar colour. A locked cell with no similar
    // neighbour is sampling noise wearing a feature's badge: unlock it so the
    // smoothing reclaims it, or lone wrong-colour studs pepper the build.
    for (let index = 0; index < surfaceCells.length; index++) {
      if (!locked[index]) continue;
      const cell = surfaceCells[index]!;
      const own = raw[index]!;
      let supported = false;
      for (const [di, dj, dk] of NEIGHBOURS) {
        const neighbour = byCoordRaw.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (neighbour === undefined) continue;
        const other = raw[neighbour]!;
        const dr = own[0] - other[0];
        const dg = own[1] - other[1];
        const db = own[2] - other[2];
        if (2 * dr * dr + 4 * dg * dg + 3 * db * db < 5200) {
          supported = true;
          break;
        }
      }
      if (!supported) locked[index] = 0;
    }
    for (let index = 0; index < raw.length; index++) {
      if (!locked[index]) raw[index] = blurred[index]!;
    }
    for (let index = 0; index < surfaceCells.length; index++) {
      const [r, g, b] = raw[index]!;
      surfaceCells[index]!.colorHex =
        `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    }
    portraitLocked = locked;
  }

  // Portraits carry more distinct materials (skin bands, hair depths, lips,
  // brows, clothing) than a toy or vase - give the clusterer more room so
  // features stop being absorbed into their neighbours.
  const centroids = naturalCentroids(surfaceCells, style === 'portrait' ? 14 : 10);
  const assignments = new Int32Array(surfaceCells.length);
  for (let index = 0; index < surfaceCells.length; index++) {
    assignments[index] = nearestColorIndex(raw[index]!, centroids);
  }

  // Remove low-contrast hue speckles with a surface-neighbour vote. Natural
  // style is strict, so high-contrast details (eyes, brows, logos) remain
  // untouched. Portrait style votes harder and iterates: baked-in scan
  // shading produces exactly the isolated one-brick outliers the strict pass
  // is designed to spare, and a face reads as material patches, not speckle.
  const portrait = style === 'portrait';
  const minVotes = portrait ? 3 : 4;
  const lumaGuard = portrait ? 70 : 30;
  const votingRounds = portrait ? 3 : 1;
  const byCoord = new Map(surfaceCells.map((cell, index) => [coord(cell), index]));
  let smoothed = new Int32Array(assignments);
  for (let round = 0; round < votingRounds; round++) {
    const previous = smoothed;
    smoothed = new Int32Array(previous);
    for (let index = 0; index < surfaceCells.length; index++) {
      if (portraitLocked?.[index]) continue;
      const cell = surfaceCells[index]!;
      const votes = new Map<number, number>();
      for (const [di, dj, dk] of NEIGHBOURS) {
        const neighbour = byCoord.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (neighbour === undefined) continue;
        const cluster = previous[neighbour]!;
        votes.set(cluster, (votes.get(cluster) ?? 0) + 1);
      }
      let winner = previous[index]!;
      let winnerVotes = 0;
      for (const [cluster, count] of votes) {
        if (count > winnerVotes) {
          winner = cluster;
          winnerVotes = count;
        }
      }
      if (winner === previous[index] || winnerVotes < minVotes) continue;
      const ownLuma = luma(raw[index]!);
      const winnerLuma = luma(centroids[winner]!);
      if (Math.abs(ownLuma - winnerLuma) < lumaGuard) smoothed[index] = winner;
    }
  }

  // Portrait skin handling: pale skin albedo sits closer to White in
  // colour distance than to any flesh tone, so faces bleach. Brick-mosaic
  // portraits solve this with a dedicated flesh ramp — any skin-like
  // cluster (warm hue, moderate saturation, mid-to-high luma) quantises
  // against the catalogue's flesh tones only.
  // Ordered light to dark by luma — the dithered per-cell assignment
  // bracket-searches this order.
  const FLESH_RAMP = ['#f2e0bd', '#ddc48e', '#DD8C59', '#947e5f', '#af7446'];
  const isSkinCentroid = ([r, g, b]: Rgb): boolean => {
    if (!(r > g && g >= b - 8)) return false;
    const spread = r - b;
    const bright = luma([r, g, b]);
    if (spread > 14 && spread < 120 && bright > 92 && bright < 235) return true;
    // Washed lit skin: near-white but still warm-ordered. A genuine white
    // (collar, paper) has r ≈ b; strongly lit skin keeps its warm cast.
    // Without this the lit cheek quantises into the white family and the
    // face reads as patchy tan-against-white instead of one skin gradient.
    return bright >= 200 && bright < 250 && r > g && g > b && spread >= 6 && spread <= 40;
  };
  const nearestOf = (colour: Rgb, ramp: string[]): string => {
    let best = ramp[0]!;
    let bestDistance = Infinity;
    for (const hex of ramp) {
      const target = hexToRgb(hex);
      const dr = colour[0] - target[0];
      const dg = colour[1] - target[1];
      const db = colour[2] - target[2];
      const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (distance < bestDistance) {
        best = hex;
        bestDistance = distance;
      }
    }
    return best;
  };
  // Hair is the other family scans mangle: one warm material lit from above
  // quantises into a hard two-tone seam. Like skin, it gets its own ramp.
  // This fixed ramp is only the classification SENTINEL — once membership is
  // known, the actual ramp is rebuilt from the palette around the source's
  // own hair colour, so auburn stays auburn and black stays black instead of
  // everything drifting to the same rust orange.
  const HAIR_RAMP = ['#af7446', '#a65322', '#692e14'];

  /**
   * Pick a light→dark 3-step ramp of catalogue colours hue-matched to `mean`
   * and luma-anchored to `lumaAnchors` (the family's own p20/p50/p80). Hue
   * similarity alone cannot separate tan from brown — tan IS lightened brown
   * — so each step is chosen among hue matches NEAR its anchor's lightness.
   */
  const dynamicWarmRamp = (mean: Rgb, lumaAnchors?: [number, number, number]): string[] => {
    const meanLuma = Math.max(1, luma(mean));
    const spreadOf = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);
    const lowSat = spreadOf(mean) / Math.max(1, Math.max(mean[0], mean[1], mean[2])) < 0.14;
    const scored: Array<{ hex: string; lumaValue: number; score: number }> = [];
    for (const entry of getPalette()) {
      const rgb: Rgb = [entry.rgb[0]!, entry.rgb[1]!, entry.rgb[2]!];
      const entryLuma = luma(rgb);
      if (entryLuma > 200) continue;
      const warm = rgb[0] >= rgb[1] - 6 && rgb[1] >= rgb[2] - 14;
      const grey = spreadOf(rgb) < 40;
      if (lowSat ? !grey : !warm) continue;
      // Compare chroma at equal luma so shading differences don't dominate,
      // and penalise saturation mismatch separately — ash-brown hair must not
      // land on saturated orange just because the hue direction matches.
      const scale = meanLuma / Math.max(1, entryLuma);
      const dr = mean[0] - rgb[0] * scale;
      const dg = mean[1] - rgb[1] * scale;
      const db = mean[2] - rgb[2] * scale;
      const meanSat = spreadOf(mean) / Math.max(1, Math.max(mean[0], mean[1], mean[2]));
      const entrySat = spreadOf(rgb) / Math.max(1, Math.max(rgb[0], rgb[1], rgb[2]));
      const satPenalty = (meanSat - entrySat) ** 2 * 60000;
      scored.push({ hex: entry.hex, lumaValue: entryLuma, score: 2 * dr * dr + 4 * dg * dg + 3 * db * db + satPenalty });
    }
    if (scored.length < 3) return HAIR_RAMP;
    const anchors = lumaAnchors ?? [
      Math.min(210, meanLuma * 1.35),
      meanLuma,
      Math.max(20, meanLuma * 0.55),
    ];
    const picks: string[] = [];
    for (const anchor of anchors) {
      let best: { hex: string } | null = null;
      let bestCombined = Infinity;
      for (const candidate of scored) {
        const lumaPenalty = ((candidate.lumaValue - anchor) / 28) ** 2;
        const combined = candidate.score / 4000 + lumaPenalty;
        if (combined < bestCombined) {
          bestCombined = combined;
          best = candidate;
        }
      }
      if (best) picks.push(best.hex);
    }
    const unique = [...new Set(picks)];
    return unique.length >= 2 ? unique : HAIR_RAMP;
  };
  const isHairCentroid = ([r, g, b]: Rgb): boolean => {
    if (!(r > g && g >= b)) return false;
    const bright = luma([r, g, b]);
    return r - b > 18 && bright < 92 && bright > 28;
  };
  const catalogHex = centroids.map((centroid) =>
    portrait && isSkinCentroid(centroid)
      ? nearestOf(centroid, FLESH_RAMP)
      : portrait && isHairCentroid(centroid)
        ? nearestOf(centroid, HAIR_RAMP)
        : quantizeToCatalog(centroid[0], centroid[1], centroid[2]),
  );

  // Portrait ramps assign PER CELL with dithering: each cell's own luma picks
  // its ramp step, and cells near a step boundary alternate by grid parity.
  // Mosaic portraits have used exactly this for years — a dithered band reads
  // as a gradient at arm's length, where a hard seam reads as colour blocking.
  const rampFor = (centroid: Rgb): string[] | null => {
    if (!portrait) return null;
    if (isSkinCentroid(centroid)) return FLESH_RAMP;
    if (isHairCentroid(centroid)) return HAIR_RAMP;
    return null;
  };
  // Family mapping is NORMALISED: each family's observed luma range (5th to
  // 95th percentile) stretches across its full ramp. Absolute mapping let a
  // brightly lit source pile every cell into the two lightest steps — washed
  // skin, blotchy fur. Normalised, shadows genuinely reach the dark steps and
  // highlights the light ones, which is what gives a face sculpted depth.
  // Family ADOPTION: the blur mixes skin and hair along their boundary into
  // clusters that match neither test and quantise to olive or sand — a green
  // smudge on every hairline. A non-family cluster whose cells sit mostly
  // against ONE family's cells joins that family and uses its ramp.
  const clusterFamily: Array<string[] | null> = centroids.map((centroid) => rampFor(centroid));
  if (portrait) {
    const adoption = centroids.map(() => new Map<string[], number>());
    const byCoordAll = new Map(surfaceCells.map((cell, index) => [coord(cell), index]));
    for (let index = 0; index < surfaceCells.length; index++) {
      const cluster = smoothed[index]!;
      if (clusterFamily[cluster]) continue;
      const cell = surfaceCells[index]!;
      for (const [di, dj, dk] of NEIGHBOURS) {
        const neighbour = byCoordAll.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (neighbour === undefined) continue;
        const family = clusterFamily[smoothed[neighbour]!];
        if (family) adoption[cluster]!.set(family, (adoption[cluster]!.get(family) ?? 0) + 1);
      }
    }
    const clusterSizes = centroids.map(() => 0);
    for (let index = 0; index < surfaceCells.length; index++) clusterSizes[smoothed[index]!]!++;
    for (let cluster = 0; cluster < centroids.length; cluster++) {
      if (clusterFamily[cluster] || !clusterSizes[cluster]) continue;
      let bestFamily: string[] | null = null;
      let bestCount = 0;
      for (const [family, count] of adoption[cluster]!) {
        if (count > bestCount) {
          bestFamily = family;
          bestCount = count;
        }
      }
      // Adopt when family contact is substantial relative to the cluster —
      // a boundary smudge touches its neighbours everywhere; a genuine
      // separate material (a collar, a backdrop) barely does.
      if (bestFamily && bestCount >= clusterSizes[cluster]! * 0.75) {
        clusterFamily[cluster] = bestFamily;
      }
    }
  }

  // With hair membership settled (classification + adoption), rebuild the
  // hair ramp around the source's actual mean hair colour and remap.
  if (portrait) {
    let hairR = 0;
    let hairG = 0;
    let hairB = 0;
    let hairCount = 0;
    const hairLumas: number[] = [];
    for (let index = 0; index < surfaceCells.length; index++) {
      if (clusterFamily[smoothed[index]!] !== HAIR_RAMP) continue;
      const [r, g, b] = raw[index]!;
      hairR += r;
      hairG += g;
      hairB += b;
      hairCount++;
      hairLumas.push(luma(raw[index]!));
    }
    if (hairCount > 24) {
      hairLumas.sort((a, b) => a - b);
      const percentile = (fraction: number) => hairLumas[Math.floor((hairLumas.length - 1) * fraction)]!;
      const dynamicHair = dynamicWarmRamp(
        [hairR / hairCount, hairG / hairCount, hairB / hairCount],
        [percentile(0.8), percentile(0.5), percentile(0.2)],
      );
      if (dynamicHair !== HAIR_RAMP) {
        for (let cluster = 0; cluster < centroids.length; cluster++) {
          if (clusterFamily[cluster] !== HAIR_RAMP) continue;
          clusterFamily[cluster] = dynamicHair;
          catalogHex[cluster] = nearestOf(centroids[cluster]!, dynamicHair);
        }
      }
    }
  }

  const familyLumas = new Map<string[], number[]>();
  for (let index = 0; index < surfaceCells.length; index++) {
    const ramp = clusterFamily[smoothed[index]!];
    if (!ramp) continue;
    let list = familyLumas.get(ramp);
    if (!list) {
      list = [];
      familyLumas.set(ramp, list);
    }
    list.push(luma(raw[index]!));
  }
  const familyRange = new Map<string[], { low: number; high: number }>();
  for (const [ramp, values] of familyLumas) {
    values.sort((a, b) => a - b);
    familyRange.set(ramp, {
      high: values[Math.ceil((values.length - 1) * 0.95)]!,
      low: values[Math.floor((values.length - 1) * 0.05)]!,
    });
  }
  // Non-family clusters dither too when the palette is genuinely ambiguous:
  // fur, paint and fabric all live BETWEEN two catalogue colours, and a
  // parity mix reads as the in-between shade the way a hard pick cannot.
  const palette = getPalette();
  const clusterPair = centroids.map((centroid, cluster) => {
    const primary = hexToRgb(catalogHex[cluster]!);
    let second: Rgb | null = null;
    let secondDistance = Infinity;
    let primaryDistance = Infinity;
    for (const entry of palette) {
      const target: Rgb = [entry.rgb[0]!, entry.rgb[1]!, entry.rgb[2]!];
      const dr = centroid[0] - target[0];
      const dg = centroid[1] - target[1];
      const db = centroid[2] - target[2];
      const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      const isPrimary = Math.abs(target[0] - primary[0]) + Math.abs(target[1] - primary[1]) + Math.abs(target[2] - primary[2]) < 3;
      if (isPrimary) {
        primaryDistance = distance;
        continue;
      }
      if (distance < secondDistance) {
        second = target;
        secondDistance = distance;
      }
    }
    if (!second || secondDistance > primaryDistance * 2.0) return null;
    return {
      aHex: catalogHex[cluster]!,
      aLuma: luma(primary),
      bHex: `#${second.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
      bLuma: luma(second),
    };
  });

  for (let index = 0; index < surfaceCells.length; index++) {
    const cell = surfaceCells[index]!;
    const cluster = smoothed[index]!;
    const ramp = clusterFamily[cluster];
    const own = luma(raw[index]!);
    const parity = (cell.i + cell.j + cell.k) % 2 === 0;
    if (ramp) {
      const range = familyRange.get(ramp)!;
      const span = Math.max(1, range.high - range.low);
      // Skin leans slightly toward its warmer mid-tones: a straight stretch
      // let lit foreheads and cheeks bleach into the palest step.
      const bias = ramp === FLESH_RAMP ? 0.08 : 0;
      const t = Math.max(0, Math.min(1, (range.high - own) / span + bias));
      const position = t * (ramp.length - 1);
      const upper = Math.floor(position);
      const lower = Math.min(upper + 1, ramp.length - 1);
      const fraction = position - upper;
      cell.stableHex = ramp[fraction <= 0.5 ? upper : lower]!;
      cell.colorHex = fraction > 0.28 && fraction < 0.72
        ? ramp[parity ? upper : lower]!
        : cell.stableHex;
      continue;
    }
    const pair = portrait ? clusterPair[cluster] : null;
    if (!pair || pair.aLuma === pair.bLuma) {
      cell.colorHex = catalogHex[cluster]!;
      cell.stableHex = cell.colorHex;
      continue;
    }
    const light = pair.aLuma > pair.bLuma ? pair : { aHex: pair.bHex, aLuma: pair.bLuma, bHex: pair.aHex, bLuma: pair.aLuma };
    const t = Math.max(0, Math.min(1, (light.aLuma - own) / (light.aLuma - light.bLuma)));
    cell.stableHex = t <= 0.5 ? light.aHex : light.bHex;
    cell.colorHex = t > 0.28 && t < 0.72
      ? (parity ? light.aHex : light.bHex)
      : cell.stableHex;
  }

  // What reads as "toy" from a distance is COLOUR NOISE: lone off-palette
  // studs (specular highlights, quantisation flips) sprinkled on coherent
  // surfaces. Real display builds keep clean regions. Suppress true
  // outliers only: a cell with at most one same-colour neighbour, whose
  // colour sits FAR from a strong local majority, adopts that majority.
  // Dither partners are near their neighbours by construction and survive.
  suppressColourOutliers(surfaceCells);

  // Boundary blur between two families (red body against grey vents) mixes
  // into a colour neither side owns, and quantisation turns that into alien
  // blobs — sage green on a red car. Kill them at REGION level: a connected
  // same-colour region of ≤6 cells whose colour is far from EVERY border
  // colour adopts its dominant border. Distance-gating keeps dither alive
  // (parity partners are near-colours) and keeps genuine small features
  // (eyes are near-black beside dark tones, protected afterwards anyway).
  absorbAlienIslands(surfaceCells);

  // Greens deserve their own rule: photo textures bake grass and ground
  // bounce into paws, sills and jawlines, and those regions are big enough
  // and internally coherent enough to defeat every generic island test. A
  // subject is either green or it is not — when green cells are a small
  // fraction of the surface, they are contamination, absorbed into their
  // warm surroundings. Genuinely green subjects (plants) sail past the
  // fraction gate untouched.
  suppressStrayGreens(surfaceCells);

  // Eyes are the difference between "a dog" and "a dog-shaped lump", and
  // they are exactly what palette averaging destroys: a 1–2 stud dark spot
  // merges into the fur centroid. Protect them: mirrored, compact, locally
  // dark clusters of RAW samples in the upper half get forced to black and
  // locked. Purely protective — nothing is invented that the source lacks.
  // Runs AFTER outlier suppression so protected features re-assert.
  protectEyeSpots(surfaceCells, raw);

  // Interior bricks cannot be seen in the approved preview.  Give them the
  // dominant visible colour so they do not add arbitrary/camouflage BOM lines.
  const interiorColor = dominantHex(surfaceCells);
  for (const cell of interiorCells) cell.colorHex = interiorColor;
}

/**
 * Lone off-palette studs read as noise from any distance. A cell with at
 * most one same-colour neighbour, whose colour is FAR from a ≥4-strong
 * neighbour majority, adopts the majority. Distance-gated so dithered
 * gradient partners (near their neighbours by construction) are untouched.
 */
function suppressColourOutliers(surfaceCells: VoxelCell[]): void {
  const rgbOf = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const far = (a: string, b: string): boolean => {
    const [ar, ag, ab] = rgbOf(a);
    const [br, bg, bb] = rgbOf(b);
    const rMean = (ar + br) / 2;
    const dr = ar - br;
    const dg = ag - bg;
    const db = ab - bb;
    const redmean = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
    return redmean > 5200;
  };
  const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  for (let round = 0; round < 2; round++) {
    const byKey = new Map(surfaceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));
    const adopt: Array<{ cell: VoxelCell; hex: string }> = [];
    for (const cell of surfaceCells) {
      const own = cell.colorHex;
      if (!own) continue;
      let same = 0;
      const counts = new Map<string, number>();
      for (const [di, dj, dk] of NEIGHBOURS) {
        const neighbour = byKey.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        const hex = neighbour?.colorHex;
        if (!hex) continue;
        if (hex === own) same += 1;
        else counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
      if (same > 1) continue;
      for (const [hex, count] of counts) {
        if (count >= 4 && far(own, hex)) {
          adopt.push({ cell, hex });
          break;
        }
      }
    }
    if (!adopt.length) break;
    for (const { cell, hex } of adopt) {
      cell.colorHex = hex;
      cell.stableHex = hex;
    }
  }
}

/**
 * Connected same-colour regions of ≤6 cells whose colour is FAR from every
 * border colour are quantisation accidents (family blur-mix at boundaries),
 * never content: absorb them into the dominant border colour.
 */
function absorbAlienIslands(surfaceCells: VoxelCell[]): void {
  const rgbOf = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const farApart = (a: string, b: string): boolean => {
    const [ar, ag, ab] = rgbOf(a);
    const [br, bg, bb] = rgbOf(b);
    const rMean = (ar + br) / 2;
    const dr = ar - br;
    const dg = ag - bg;
    const db = ab - bb;
    return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db > 5200;
  };
  const NEIGHBOURS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  const byKey = new Map(surfaceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));
  const visited = new Set<VoxelCell>();
  // "Small" must scale with grid density: a plate grid has 3x the cells of a
  // brick grid, so the same physical blob spans 3x the region size.
  const alienCap = Math.max(12, Math.round(surfaceCells.length * 0.0006));
  const alienStat = { cap: alienCap, absorbed: 0, keptSize: 0, keptNear: 0, cells: 0 };
  (globalThis as unknown as { __alienStat?: typeof alienStat }).__alienStat = alienStat;
  for (const seed of surfaceCells) {
    if (visited.has(seed) || !seed.colorHex) continue;
    const colour = seed.colorHex;
    const region: VoxelCell[] = [];
    const stack = [seed];
    visited.add(seed);
    while (stack.length && region.length <= alienCap + 1) {
      const cell = stack.pop()!;
      region.push(cell);
      for (const [di, dj, dk] of NEIGHBOURS6) {
        const neighbour = byKey.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (!neighbour || visited.has(neighbour) || neighbour.colorHex !== colour) continue;
        visited.add(neighbour);
        stack.push(neighbour);
      }
    }
    if (region.length > alienCap) { alienStat.keptSize += 1; continue; }
    const borderCounts = new Map<string, number>();
    const inRegion = new Set(region);
    for (const cell of region) {
      for (const [di, dj, dk] of NEIGHBOURS6) {
        const neighbour = byKey.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (!neighbour || inRegion.has(neighbour) || !neighbour.colorHex) continue;
        borderCounts.set(neighbour.colorHex, (borderCounts.get(neighbour.colorHex) ?? 0) + 1);
      }
    }
    if (!borderCounts.size) continue;
    let dominant = '';
    let dominantCount = 0;
    for (const [hex, count] of borderCounts) {
      if (count > dominantCount) { dominant = hex; dominantCount = count; }
    }
    // Judge against the DOMINANT border only: a dither cell's dominant
    // neighbour is its near-colour partner (kept), while an alien blob's
    // dominant neighbour is the surface it interrupts (absorbed) — minority
    // borders like an adjacent shadow band must not veto the merge.
    if (!dominant || !farApart(colour, dominant)) { alienStat.keptNear += 1; continue; }
    alienStat.absorbed += 1;
    alienStat.cells += region.length;
    for (const cell of region) {
      cell.colorHex = dominant;
      cell.stableHex = dominant;
    }
  }
}

/**
 * Absorb stray green cells into their warm surroundings when green is a
 * small fraction of the surface — baked grass/ground bounce, never content.
 */
function suppressStrayGreens(surfaceCells: VoxelCell[]): void {
  const isGreen = (hex: string | undefined): boolean => {
    if (!hex) return false;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    // True greens AND olives/sages: green channel leads blue clearly and is
    // at least on par with red. Warm tones (skin, tan, fur) have r well
    // above g; neutrals have b close to g. Both stay untouched.
    return g > b + 16 && g > r - 6;
  };
  const greens = surfaceCells.filter((cell) => isGreen(cell.colorHex));
  // A genuinely green subject keeps its colour; contamination is sparse.
  if (!greens.length || greens.length > surfaceCells.length * 0.06) return;
  const byKey = new Map(surfaceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));
  for (let round = 0; round < 3; round++) {
    let changed = 0;
    for (const cell of surfaceCells) {
      if (!isGreen(cell.colorHex)) continue;
      const counts = new Map<string, number>();
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let dk = -1; dk <= 1; dk++) {
            if (!di && !dj && !dk) continue;
            const neighbour = byKey.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
            const hex = neighbour?.colorHex;
            if (!hex || isGreen(hex)) continue;
            counts.set(hex, (counts.get(hex) ?? 0) + 1);
          }
        }
      }
      let dominant = '';
      let dominantCount = 0;
      for (const [hex, count] of counts) {
        if (count > dominantCount) { dominant = hex; dominantCount = count; }
      }
      if (dominantCount >= 4) {
        cell.colorHex = dominant;
        cell.stableHex = dominant;
        changed += 1;
      }
    }
    if (!changed) break;
  }
}

/** Catalog black — the strongest eye/feature contrast the palette offers. */
const EYE_HEX = '#05131D';

function protectEyeSpots(surfaceCells: VoxelCell[], raw: Rgb[]): void {
  const eyeStat = { candidates: 0, clusters: 0, pairs: 0, forced: 0 };
  (globalThis as unknown as { __eyeStat?: typeof eyeStat }).__eyeStat = eyeStat;
  let minJ = Infinity;
  let maxJ = -Infinity;
  for (const cell of surfaceCells) {
    minJ = Math.min(minJ, cell.j);
    maxJ = Math.max(maxJ, cell.j);
  }
  const eyeFloor = minJ + (maxJ - minJ) * 0.5;
  const byCoord = new Map(surfaceCells.map((cell, index) => [`${cell.i}|${cell.j}|${cell.k}`, index]));
  // A candidate is dark in absolute terms AND darker than its neighbourhood:
  // shadowed fur is dark too, but not darker than what surrounds it.
  const candidateIndices = new Set<number>();
  for (let index = 0; index < surfaceCells.length; index++) {
    const cell = surfaceCells[index]!;
    if (cell.j < eyeFloor) continue;
    const own = luma(raw[index]!);
    if (own > 70) continue;
    let sum = 0;
    let count = 0;
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        for (let dk = -2; dk <= 2; dk++) {
          const neighbour = byCoord.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
          if (neighbour === undefined || neighbour === index) continue;
          sum += luma(raw[neighbour]!);
          count += 1;
        }
      }
    }
    if (count < 8 || own > sum / count - 22) continue;
    candidateIndices.add(index);
  }
  eyeStat.candidates = candidateIndices.size;
  if (!candidateIndices.size) return;
  // Flood candidates into compact clusters.
  interface EyeCluster { indices: number[]; ci: number; cj: number; ck: number; size: number }
  const clusters: EyeCluster[] = [];
  const seen = new Set<number>();
  for (const start of candidateIndices) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const members: number[] = [];
    while (queue.length) {
      const index = queue.pop()!;
      members.push(index);
      const cell = surfaceCells[index]!;
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const neighbour = byCoord.get(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`);
        if (neighbour === undefined || seen.has(neighbour) || !candidateIndices.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    let minI2 = Infinity;
    let maxI2 = -Infinity;
    let minJ2 = Infinity;
    let maxJ2 = -Infinity;
    let minK2 = Infinity;
    let maxK2 = -Infinity;
    let sumI = 0;
    let sumJ = 0;
    let sumK = 0;
    for (const index of members) {
      const cell = surfaceCells[index]!;
      minI2 = Math.min(minI2, cell.i);
      maxI2 = Math.max(maxI2, cell.i);
      minJ2 = Math.min(minJ2, cell.j);
      maxJ2 = Math.max(maxJ2, cell.j);
      minK2 = Math.min(minK2, cell.k);
      maxK2 = Math.max(maxK2, cell.k);
      sumI += cell.i;
      sumJ += cell.j;
      sumK += cell.k;
    }
    // Eyes are small and compact; long dark streaks are shadow or hair.
    if (members.length < 2 || members.length > 40) continue;
    if (maxI2 - minI2 > 4 || maxJ2 - minJ2 > 4 || maxK2 - minK2 > 4) continue;
    clusters.push({
      ci: sumI / members.length,
      cj: sumJ / members.length,
      ck: sumK / members.length,
      indices: members,
      size: members.length,
    });
  }
  eyeStat.clusters = clusters.length;
  if (clusters.length < 2) return;
  // Eyes come in mirrored pairs. The mirror plane is unknown (models face
  // any way), so try both mid-planes and keep the best-matching pairs.
  let sumCi = 0;
  let sumCk = 0;
  for (const cell of surfaceCells) {
    sumCi += cell.i;
    sumCk += cell.k;
  }
  const midI = sumCi / surfaceCells.length;
  const midK = sumCk / surfaceCells.length;
  const paired = new Set<EyeCluster>();
  const pairs: Array<[EyeCluster, EyeCluster]> = [];
  for (const a of clusters) {
    if (paired.has(a)) continue;
    for (const b of clusters) {
      if (a === b || paired.has(b)) continue;
      const sizeRatio = Math.max(a.size, b.size) / Math.min(a.size, b.size);
      if (sizeRatio > 3) continue;
      if (Math.abs(a.cj - b.cj) > 2.5) continue;
      const mirrorI = Math.abs((2 * midI - a.ci) - b.ci) <= 3 && Math.abs(a.ck - b.ck) <= 3;
      const mirrorK = Math.abs((2 * midK - a.ck) - b.ck) <= 3 && Math.abs(a.ci - b.ci) <= 3;
      // A genuine pair is separated — mirrored twins hugging the mid-plane
      // are one nose split in two.
      const apart = Math.abs(a.ci - b.ci) + Math.abs(a.ck - b.ck) >= 3;
      if ((mirrorI || mirrorK) && apart) {
        paired.add(a);
        paired.add(b);
        pairs.push([a, b]);
        break;
      }
    }
    if (pairs.length >= 2) break;
  }
  eyeStat.pairs = pairs.length;
  for (const [a, b] of pairs) {
    for (const index of [...a.indices, ...b.indices]) {
      const cell = surfaceCells[index]!;
      cell.colorHex = EYE_HEX;
      cell.stableHex = EYE_HEX;
      eyeStat.forced += 1;
    }
  }
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
