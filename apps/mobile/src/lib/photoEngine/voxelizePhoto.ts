/**
 * Photo-driven voxelization: turns a segmented silhouette into a 3D brick
 * model. The silhouette is downsampled to the profile resolution, inflated
 * into depth using the distance-to-edge of each cell (round forms bulge,
 * thin parts stay thin), and every voxel is coloured by quantizing the
 * photo's pixels to real catalog colours.
 *
 * This is a single-view interpretation — honest copy in the UI calls it a
 * silhouette-based reconstruction, not an exact replica.
 */

import catalog from '../../data/brickCatalog.json';
import { buildModelFromCells, type VoxelCell, type VoxelModel } from '../voxelFox';
import type { BuildProfile } from '../voxelFox';
import type { Segmentation } from './segment';

export type PhotoBuildMode = 'volume' | 'relief';

/**
 * Panel rendering styles. Faces read through VALUE, not hue — the classic
 * and sepia ramps map contrast-stretched luminance through a fixed ladder of
 * real catalog colours with Floyd–Steinberg dithering, which is how
 * commercial brick portraits achieve likeness.
 */
export type PanelStyle = 'natural' | 'classic' | 'sepia';

export interface PhotoModels {
  label: string;
  mode: PhotoBuildMode;
  style: PanelStyle;
  /** Object category detected at capture ('portrait', 'animal', …). */
  category?: string;
  /** True when facial landmarks were stamped into the build. */
  hasFace?: boolean;
  /** True when the volume build used measured depth, not just inflation. */
  hasDepth: boolean;
  models: Record<BuildProfile, VoxelModel>;
}

/** Real catalog colours: five neutral values keep facial mid-tones readable. */
const CLASSIC_RAMP = ['#000000', '#646767', '#A0A19F', '#D9D9D6', '#FFFFFF'];
/** Seven real warm catalog values preserve more portrait shading than five. */
const SEPIA_RAMP = ['#3B180D', '#692E14', '#947E5F', '#DD8C59', '#DDC48E', '#F2E0BD', '#FFFFFF'];

const WIDTH_BY_PROFILE: Record<BuildProfile, number> = {
  efficient: 16,
  balanced: 26,
  detailed: 38,
};

/** Relief panels need face-level resolution — like commercial brick portraits. */
const RELIEF_WIDTH_BY_PROFILE: Record<BuildProfile, number> = {
  efficient: 36,
  balanced: 52,
  detailed: 68,
};

/** Dominant tones kept per mode — coherent regions, no confetti. Portrait
 * panels get a richer palette so skin/hair shading survives. */
const PALETTE_SIZE_BY_MODE: Record<PhotoBuildMode, number> = {
  relief: 22,
  volume: 8,
};

/** World height budget so photo models project like the built-in objects. */
const WORLD_HEIGHT = 6.3;

interface PaletteEntry {
  rgb: [number, number, number];
  hex: string;
}

let palette: PaletteEntry[] | null = null;

/**
 * The FULL solid-colour inventory (93 real colours, flesh tones included).
 * Scarcity no longer excludes colours from matching — it only raises the
 * estimated price of the parts that use them.
 */
function getPalette(): PaletteEntry[] {
  if (palette) {
    return palette;
  }
  palette = catalog.colors
    .filter((color) => !color.trans)
    .map((color) => {
      const hex = color.rgb.replace('#', '');
      return {
        hex: color.rgb,
        rgb: [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16),
        ] as [number, number, number],
      };
    });
  return palette;
}

/**
 * "Redmean" perceptual colour distance — hue-preserving, so dark browns
 * stay brown instead of snapping to dark green, and warm skin tones land
 * on the nougat family rather than pinks or greys.
 */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

export function quantizeToCatalog(r: number, g: number, b: number, exclude?: Set<string>): string {
  let best = '#B40000';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of getPalette()) {
    if (exclude?.has(entry.hex)) continue;
    const distance = colorDistance(r, g, b, entry.rgb[0], entry.rgb[1], entry.rgb[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.hex;
    }
  }
  return best;
}

type Rgb = [number, number, number];

/**
 * Posterize the object's cell colours into a small deliberate palette:
 * deterministic k-means over the filled cells, a majority filter to fuse
 * regions, then each cluster maps to a DISTINCT catalog colour. This is what
 * turns per-cell quantization noise into the coherent zones a real brick
 * portrait uses.
 */
function posterize(cells: Cell2D[][], width: number, height: number, paletteSize: number): void {
  const samples: { x: number; y: number; color: Rgb }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (cell.filled && cell.color) {
        samples.push({ color: cell.color as Rgb, x, y });
      }
    }
  }
  if (samples.length === 0) return;

  const k = Math.min(paletteSize, samples.length);
  // Deterministic init: spread across the luminance range.
  const byLuma = [...samples].sort(
    (a, b) =>
      a.color[0] * 0.3 + a.color[1] * 0.59 + a.color[2] * 0.11 -
      (b.color[0] * 0.3 + b.color[1] * 0.59 + b.color[2] * 0.11),
  );
  let centroids: Rgb[] = Array.from({ length: k }, (_, index) => {
    const pick = byLuma[Math.floor(((index + 0.5) / k) * byLuma.length)]!;
    return [...pick.color] as Rgb;
  });

  const assign = new Int32Array(samples.length);
  const distanceTo = (color: Rgb, centroid: Rgb) =>
    colorDistance(color[0], color[1], color[2], centroid[0], centroid[1], centroid[2]);

  for (let iteration = 0; iteration < 8; iteration++) {
    for (let index = 0; index < samples.length; index++) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c++) {
        const distance = distanceTo(samples[index]!.color, centroids[c]!);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      assign[index] = best;
    }
    const sums: number[][] = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let index = 0; index < samples.length; index++) {
      const sum = sums[assign[index]!]!;
      sum[0]! += samples[index]!.color[0];
      sum[1]! += samples[index]!.color[1];
      sum[2]! += samples[index]!.color[2];
      sum[3]! += 1;
    }
    centroids = centroids.map((old, c) => {
      const sum = sums[c]!;
      return sum[3]! > 0 ? ([sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!] as Rgb) : old;
    });
  }

  // Cluster index per grid cell, then an edge-aware 3×3 majority filter.
  // The old unconditional majority pass erased one- and two-cell facial
  // details (eyes, brows, nostrils) even when the source sampling captured
  // them. Only isolated, low-contrast colour noise is fused now.
  const clusterGrid: Int32Array = new Int32Array(width * height).fill(-1);
  samples.forEach((sample, index) => {
    clusterGrid[sample.y * width + sample.x] = assign[index]!;
  });
  const smoothed = new Int32Array(clusterGrid);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (clusterGrid[y * width + x] === -1) continue;
      if (cells[y]![x]!.feature) continue; // eyes/nostrils/mouths survive smoothing
      const votes = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const cluster = clusterGrid[ny * width + nx]!;
          if (cluster !== -1) votes.set(cluster, (votes.get(cluster) ?? 0) + 1);
        }
      }
      const currentCluster = clusterGrid[y * width + x]!;
      const currentVotes = votes.get(currentCluster) ?? 0;
      let bestCluster = currentCluster;
      let bestVotes = currentVotes;
      for (const [cluster, count] of votes) {
        if (count > bestVotes) {
          bestVotes = count;
          bestCluster = cluster;
        }
      }
      if (bestCluster === currentCluster || bestVotes < 6 || currentVotes > 2) continue;

      const cell = cells[y]![x]!;
      if (!cell.color) continue;
      let neighbourLuma = 0;
      let neighbourCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (clusterGrid[ny * width + nx] !== bestCluster) continue;
          const color = cells[ny]![nx]!.color;
          if (!color) continue;
          neighbourLuma += 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
          neighbourCount++;
        }
      }
      const ownLuma = 0.299 * cell.color[0] + 0.587 * cell.color[1] + 0.114 * cell.color[2];
      const localContrast = neighbourCount ? Math.abs(ownLuma - neighbourLuma / neighbourCount) : 0;
      const majorityDistance = distanceTo(cell.color as Rgb, centroids[bestCluster]!);
      if (localContrast < 18 && majorityDistance < 2200) {
        smoothed[y * width + x] = bestCluster;
      }
    }
  }

  // Nearest catalog colour per cluster. Clusters MAY share a colour — on a
  // mostly one-colour object several clusters are near-duplicates, and
  // forcing distinct colours spreads them onto wrong hues (red → magenta).
  const clusterHex = centroids.map((centroid) =>
    quantizeToCatalog(centroid[0], centroid[1], centroid[2]),
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      const cluster = smoothed[y * width + x]!;
      if (cluster !== -1) {
        cell.posterHex = clusterHex[cluster]!;
      }
      // Feature cells quantize from their own (dark) colour so eyes and
      // noses never dissolve into the surrounding skin/fur cluster.
      if (cell.feature && cell.color) {
        cell.posterHex = quantizeToCatalog(cell.color[0], cell.color[1], cell.color[2]);
      }
    }
  }
}

interface Cell2D {
  filled: boolean;
  color: [number, number, number] | null;
  /** Catalog colour assigned by posterization. */
  posterHex?: string;
  /** Average relative closeness from the depth model (larger = closer). */
  depth?: number;
  /** Dark local feature (eye, nostril, mouth) — protected from smoothing. */
  feature?: boolean;
}

/**
 * Mark small dark local minima in the upper part of the object as features.
 * Eyes, nostrils and mouths are exactly this: compact regions clearly darker
 * than their surroundings. Protecting them from the smoothing/clustering
 * passes keeps animal and human faces readable.
 */
function markDarkFeatures(cells: Cell2D[][], width: number, height: number): void {
  const luma = (cell: Cell2D) =>
    cell.color ? 0.299 * cell.color[0] + 0.587 * cell.color[1] + 0.114 * cell.color[2] : 255;

  const featureBand = Math.ceil(height * 0.7); // faces live in the upper 70 %
  for (let y = 0; y < featureBand; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (!cell.filled || !cell.color) continue;

      let ringSum = 0;
      let ringCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue; // outer ring only
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = cells[ny]![nx]!;
          if (neighbour.filled && neighbour.color) {
            ringSum += luma(neighbour);
            ringCount++;
          }
        }
      }
      if (ringCount >= 6 && luma(cell) < ringSum / ringCount - 34) {
        cell.feature = true;
      }
    }
  }
}

interface DownsampleResult {
  cells: Cell2D[][];
  width: number;
  height: number;
  /** Object bounding box within the segmentation grid (for feature mapping). */
  minX: number;
  minY: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** Downsample the segmentation to the profile grid, cropped to the object. */
function downsample(segmentation: Segmentation, targetWidth: number, fillThreshold = 0.5): DownsampleResult {
  const { grid, mask, colors } = segmentation;

  let minX = grid, maxX = -1, minY = grid, maxY = -1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (mask[y * grid + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) {
    return { cells: [], height: 0, minX: 0, minY: 0, sourceHeight: 0, sourceWidth: 0, width: 0 };
  }

  const sourceWidth = maxX - minX + 1;
  const sourceHeight = maxY - minY + 1;
  // Never create apparent detail beyond the segmentation grid. It adds many
  // bricks but only duplicates source cells, making the result chunkier and
  // slower without increasing likeness.
  const cropAspect = Math.max(0.05, segmentation.aspectRatio ?? 1);
  const physicalAspect = (sourceWidth * cropAspect) / Math.max(sourceHeight, 1);
  const longestSide = Math.min(
    targetWidth,
    Math.max(sourceWidth * cropAspect, sourceHeight),
  );
  const width = physicalAspect >= 1
    ? Math.max(4, Math.round(longestSide))
    : Math.max(4, Math.round(longestSide * physicalAspect));
  const height = physicalAspect >= 1
    ? Math.max(4, Math.round(longestSide / physicalAspect))
    : Math.max(4, Math.round(longestSide));

  const cells: Cell2D[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Cell2D[] = [];
    for (let x = 0; x < width; x++) {
      const x0 = minX + Math.floor((x * sourceWidth) / width);
      const x1 = minX + Math.max(Math.floor(((x + 1) * sourceWidth) / width), Math.floor((x * sourceWidth) / width) + 1);
      const y0 = minY + Math.floor((y * sourceHeight) / height);
      const y1 = minY + Math.max(Math.floor(((y + 1) * sourceHeight) / height), Math.floor((y * sourceHeight) / height) + 1);

      let filledCount = 0, total = 0, r = 0, g = 0, b = 0, colored = 0, depthSum = 0, depthCount = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          total++;
          const cell = sy * grid + sx;
          if (mask[cell]) {
            filledCount++;
            const color = colors[cell];
            if (color) {
              r += color[0];
              g += color[1];
              b += color[2];
              colored++;
            }
            if (segmentation.depth) {
              depthSum += segmentation.depth[cell]!;
              depthCount++;
            }
          }
        }
      }
      const filled = filledCount / Math.max(total, 1) >= fillThreshold;
      row.push({
        color: colored ? [r / colored, g / colored, b / colored] : null,
        depth: depthCount ? depthSum / depthCount : undefined,
        filled,
      });
    }
    cells.push(row);
  }
  return { cells, height, minX, minY, sourceHeight, sourceWidth, width };
}

/** BFS distance-to-background per filled cell (4-neighbourhood). */
function distanceToEdge(cells: Cell2D[][], width: number, height: number): number[][] {
  const INF = 1e9;
  const distance: number[][] = cells.map((row) => row.map((cell) => (cell.filled ? INF : 0)));
  const queue: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cells[y]![x]!.filled) {
        queue.push([x, y]);
      } else if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        // The crop hugs the silhouette, so filled edge cells need an explicit
        // outside-of-grid background seed. Without this, a full rectangular
        // panel has infinite distance everywhere.
        distance[y]![x] = 1;
        queue.push([x, y]);
      }
    }
  }
  let head = 0;
  const push = (x: number, y: number, d: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (distance[y]![x]! > d) {
      distance[y]![x] = d;
      queue.push([x, y]);
    }
  };
  while (head < queue.length) {
    const [x, y] = queue[head++]!;
    const d = distance[y]?.[x] ?? 0;
    push(x + 1, y, d + 1);
    push(x - 1, y, d + 1);
    push(x, y + 1, d + 1);
    push(x, y - 1, d + 1);
  }
  return distance;
}

/**
 * Value-based panel colouring: contrast-stretch the object's luminance, then
 * Floyd–Steinberg dither it through a fixed ramp of catalog colours. Error
 * diffusion only flows through masked cells so the silhouette stays crisp.
 */
function ditherToRamp(cells: Cell2D[][], width: number, height: number, ramp: string[]): void {
  const sourceLuminance = new Float32Array(width * height).fill(-1);
  const values: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (cell.filled && cell.color) {
        const value = 0.299 * cell.color[0] + 0.587 * cell.color[1] + 0.114 * cell.color[2];
        sourceLuminance[y * width + x] = value;
        values.push(value);
      }
    }
  }
  if (!values.length) return;

  // Contrast stretch (5th–95th percentile → full range) so flat, evenly-lit
  // photos still produce strong facial structure.
  values.sort((a, b) => a - b);
  const low = values[Math.floor(values.length * 0.05)]!;
  const high = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;
  const span = Math.max(high - low, 1);

  // A mild local-contrast pass recovers eyes, brows, mouths and hair strands
  // from evenly lit photos. It is deliberately capped so skin texture does
  // not turn into noisy brick confetti.
  const luminance = new Float32Array(sourceLuminance);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const source = sourceLuminance[index]!;
      if (source < 0) continue;
      let localSum = 0;
      let localCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = sourceLuminance[ny * width + nx]!;
          if (neighbour < 0) continue;
          localSum += neighbour;
          localCount++;
        }
      }
      const stretched = ((source - low) / span) * 255;
      const localMean = localCount ? localSum / localCount : source;
      const detail = Math.max(-48, Math.min(48, ((source - localMean) / span) * 255 * 0.62));
      luminance[index] = Math.max(0, Math.min(255, stretched + detail));
    }
  }

  // Quantize against the catalog colours' real luminance rather than evenly
  // spaced indices. This avoids overusing a mid-tone whose physical colour
  // is much lighter or darker than its position in the ramp suggests.
  const rampLuma = ramp.map((hex) => {
    const normalized = hex.replace('#', '');
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  });
  const rampLow = rampLuma[0] ?? 0;
  const rampSpan = Math.max((rampLuma[rampLuma.length - 1] ?? 255) - rampLow, 1);
  const levels = rampLuma.map((value) => ((value - rampLow) / rampSpan) * 255);

  // Serpentine Floyd–Steinberg diffusion avoids the diagonal streaks a
  // one-direction scan creates across cheeks and other smooth gradients.
  for (let y = 0; y < height; y++) {
    const direction = y % 2 === 0 ? 1 : -1;
    for (let offset = 0; offset < width; offset++) {
      const x = direction === 1 ? offset : width - 1 - offset;
      const index = y * width + x;
      if (sourceLuminance[index]! < 0) continue;
      const value = Math.max(0, Math.min(255, luminance[index]!));
      let level = 0;
      let nearest = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < levels.length; candidate++) {
        const difference = Math.abs(value - levels[candidate]!);
        if (difference < nearest) {
          nearest = difference;
          level = candidate;
        }
      }
      cells[y]![x]!.posterHex = ramp[level]!;

      const error = value - levels[level]!;
      const spread: Array<[number, number, number]> = [
        [x + direction, y, 7 / 16],
        [x - direction, y + 1, 3 / 16],
        [x, y + 1, 5 / 16],
        [x + direction, y + 1, 1 / 16],
      ];
      for (const [nx, ny, weight] of spread) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (sourceLuminance[neighbour]! >= 0) {
          luminance[neighbour] = luminance[neighbour]! + error * weight;
        }
      }
    }
  }
}

export interface FacePoints {
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  noseTip: { x: number; y: number };
  mouth: { x: number; y: number };
  leftEar: { x: number; y: number } | null;
  rightEar: { x: number; y: number } | null;
  /** Precise outlines when FaceMesh landmarks were available. */
  contours?: {
    leftEye: Array<{ x: number; y: number }>;
    rightEye: Array<{ x: number; y: number }>;
    lips: Array<{ x: number; y: number }>;
    leftBrow: Array<{ x: number; y: number }>;
    rightBrow: Array<{ x: number; y: number }>;
  };
}

/** Ray-casting point-in-polygon test. */
function insidePolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
    const pa = polygon[a]!;
    const pb = polygon[b]!;
    if (pa.y > y !== pb.y > y && x < ((pb.x - pa.x) * (y - pa.y)) / (pb.y - pa.y) + pa.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Stamp guaranteed facial features from detected landmarks: dark pupils with
 * light halos, a nose shade, a mouth line, and ear accents — sized from the
 * interocular distance and clipped to the object mask.
 */
function stampFacialFeatures(
  result: DownsampleResult,
  segmentation: Segmentation,
  face: FacePoints,
  style: PanelStyle,
): void {
  const { cells, width, height, minX, minY, sourceWidth, sourceHeight } = result;
  if (!width || !height || !sourceWidth || !sourceHeight) return;
  const grid = segmentation.grid;

  const toCell = (point: { x: number; y: number }) => ({
    x: Math.round(((point.x * grid - minX) / sourceWidth) * width),
    y: Math.round(((point.y * grid - minY) / sourceHeight) * height),
  });

  const paint = (x: number, y: number, hex: string) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const cell = cells[y]![x]!;
    if (!cell.filled) return;
    cell.posterHex = hex;
    cell.feature = true;
  };

  const dark = style === 'sepia' ? '#352100' : '#05131D';
  const light = '#FFFFFF';
  const noseShade = style === 'classic' ? '#6C6E68' : style === 'sepia' ? '#582A12' : '#AA7D55';
  const mouthTone = style === 'classic' ? '#05131D' : '#582A12';

  const leftEye = toCell(face.leftEye);
  const rightEye = toCell(face.rightEye);
  const interocular = Math.max(2, Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y));
  const eyeRadius = Math.max(0, Math.round(interocular * 0.14) - 1);

  // FaceMesh contours: fill actual feature shapes instead of circles.
  if (face.contours) {
    const fillContour = (points: Array<{ x: number; y: number }>, hex: string) => {
      const cellsPoly = points.map(toCell);
      const xs = cellsPoly.map((point) => point.x);
      const ys = cellsPoly.map((point) => point.y);
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(width - 1, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const y1 = Math.min(height - 1, Math.max(...ys));
      let painted = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (insidePolygon(x + 0.5, y + 0.5, cellsPoly)) {
            paint(x, y, hex);
            painted++;
          }
        }
      }
      // Contour thinner than one cell: paint the outline cells directly.
      if (!painted) {
        for (const point of cellsPoly) paint(point.x, point.y, hex);
      }
    };

    fillContour(face.contours.leftEye, light);
    fillContour(face.contours.rightEye, light);
    // Irises at the eye centres, on top of the sclera fill.
    const irisRadius = Math.max(0, Math.round(interocular * 0.1) - 1);
    for (const eye of [leftEye, rightEye]) {
      for (let dy = -irisRadius; dy <= irisRadius; dy++) {
        for (let dx = -irisRadius; dx <= irisRadius; dx++) {
          if (Math.hypot(dx, dy) <= irisRadius + 0.2) paint(eye.x + dx, eye.y + dy, dark);
        }
      }
    }
    fillContour(face.contours.leftBrow, dark);
    fillContour(face.contours.rightBrow, dark);
    fillContour(face.contours.lips, mouthTone);

    const nose = toCell(face.noseTip);
    const noseRadius = Math.max(0, Math.round(interocular * 0.09) - 1);
    for (let dy = -noseRadius; dy <= noseRadius; dy++) {
      for (let dx = -noseRadius; dx <= noseRadius; dx++) {
        paint(nose.x + dx, nose.y + dy, noseShade);
      }
    }
    for (const ear of [face.leftEar, face.rightEar]) {
      if (!ear) continue;
      const cell = toCell(ear);
      paint(cell.x, cell.y, noseShade);
      paint(cell.x, cell.y + 1, noseShade);
    }
    return;
  }

  for (const eye of [leftEye, rightEye]) {
    // Light halo first, pupil on top.
    for (let dy = -eyeRadius - 1; dy <= eyeRadius + 1; dy++) {
      for (let dx = -eyeRadius - 1; dx <= eyeRadius + 1; dx++) {
        if (Math.hypot(dx, dy) <= eyeRadius + 1.2) paint(eye.x + dx, eye.y + dy, light);
      }
    }
    for (let dy = -eyeRadius; dy <= eyeRadius; dy++) {
      for (let dx = -eyeRadius; dx <= eyeRadius; dx++) {
        if (Math.hypot(dx, dy) <= eyeRadius + 0.2) paint(eye.x + dx, eye.y + dy, dark);
      }
    }
  }

  const nose = toCell(face.noseTip);
  const noseRadius = Math.max(0, Math.round(interocular * 0.1) - 1);
  for (let dy = -noseRadius; dy <= noseRadius; dy++) {
    for (let dx = -noseRadius; dx <= noseRadius; dx++) {
      paint(nose.x + dx, nose.y + dy, noseShade);
    }
  }

  const mouth = toCell(face.mouth);
  const mouthHalf = Math.max(1, Math.round(interocular * 0.32));
  for (let dx = -mouthHalf; dx <= mouthHalf; dx++) {
    paint(mouth.x + dx, mouth.y, mouthTone);
  }

  for (const ear of [face.leftEar, face.rightEar]) {
    if (!ear) continue;
    const cell = toCell(ear);
    paint(cell.x, cell.y, noseShade);
    paint(cell.x, cell.y + 1, noseShade);
  }
}

/** Silhouette-edge cells mix object and background pixels; borrow interior tones. */
function fixEdgeColors(cells: Cell2D[][], distance: number[][], width: number, height: number) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (!cell.filled || (distance[y]?.[x] ?? 0) > 1) continue;
      outer: for (let ring = 1; ring <= 3; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if ((distance[ny]?.[nx] ?? 0) >= 2 && cells[ny]![nx]!.posterHex) {
              cell.posterHex = cells[ny]![nx]!.posterHex;
              break outer;
            }
          }
        }
      }
    }
  }
}

export function voxelizeSegmentation(
  segmentation: Segmentation,
  profile: BuildProfile,
  mode: PhotoBuildMode = 'volume',
  style: PanelStyle = 'natural',
  face: FacePoints | null = null,
  preserveFeatures = false,
): VoxelModel {
  const targetWidth = mode === 'relief' ? RELIEF_WIDTH_BY_PROFILE[profile] : WIDTH_BY_PROFILE[profile];
  // A 35% coverage threshold retains thin hair, glasses and silhouette tips
  // in a flat panel. Volumes stay at 50% so they remain structurally solid.
  const result = downsample(segmentation, targetWidth, mode === 'relief' ? 0.35 : 0.5);
  const { cells, width, height } = result;
  if (!width || !height) {
    return buildModelFromCells([], 0.3);
  }

  // Animals & people: protect small dark features (eyes, nose, mouth) from
  // the smoothing passes even when no landmark model fired.
  if (preserveFeatures || mode === 'relief') {
    markDarkFeatures(cells, width, height);
  }

  const distance = distanceToEdge(cells, width, height);
  if (mode === 'relief' && style !== 'natural') {
    ditherToRamp(cells, width, height, style === 'classic' ? CLASSIC_RAMP : SEPIA_RAMP);
  } else {
    posterize(cells, width, height, PALETTE_SIZE_BY_MODE[mode]);
    // Only a cut-out silhouette has mixed foreground/background edge pixels.
    // A full-frame mosaic must keep the buyer's real border colours.
    if (segmentation.coverage < 0.98) {
      fixEdgeColors(cells, distance, width, height);
    }
  }

  // Landmark-guaranteed eyes / ears / nose / mouth.
  if (face) {
    stampFacialFeatures(result, segmentation, face, style);
  }

  const maxDepth = Math.max(2, Math.round(Math.min(width, height) * 0.42));
  const size = WORLD_HEIGHT / Math.max(height, width);

  // Real depth: normalise the model's relative closeness across the object
  // (10th–90th percentile) so the nearest surfaces get the full front budget.
  const depthValues: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (cell.filled && cell.depth !== undefined) {
        depthValues.push(cell.depth);
      }
    }
  }
  depthValues.sort((a, b) => a - b);
  const depthLow = depthValues[Math.floor(depthValues.length * 0.1)] ?? 0;
  const depthHigh = depthValues[Math.min(depthValues.length - 1, Math.floor(depthValues.length * 0.9))] ?? 1;
  const depthSpan = Math.max(depthHigh - depthLow, 1e-6);
  const useDepth = mode === 'volume' && depthValues.length > 0;

  const voxels: VoxelCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = cells[y]![x]!;
      if (!cell.filled) continue;

      const colorHex = cell.posterHex ?? '#9BA19D';
      const j = height - 1 - y; // photo y grows down, world y grows up

      // Relief: flat mosaic panel two bricks deep — the brick-portrait look.
      // Volume without depth: silhouette inflated by distance-to-edge.
      // Volume with depth: the measured front surface protrudes toward the
      // viewer, the inflated back keeps the body solid.
      let kStart: number;
      let kEnd: number;
      if (mode === 'relief') {
        kStart = -1;
        kEnd = 1;
      } else {
        const back = Math.min(maxDepth, Math.max(1, Math.round(distance[y]![x]! * 0.9)));
        if (useDepth) {
          // Depth alone must never be the sole driver of the front bulge: a
          // full-body photo's measured closeness runs smoothly head-to-toe
          // (perspective/camera distance), completely independent of the
          // silhouette's actual cross-section — driven raw, it makes narrow
          // parts (a neck, an ankle) bulge MORE than wide parts (shoulders),
          // producing a tapered "melted pillar" instead of a body. Local
          // silhouette width (the same distance-to-edge signal that drives
          // the back) sets the base bulge; measured depth only modulates it
          // within a bounded range, so the front stays shape-coherent while
          // still following real relative depth (near arm vs. set-back torso).
          const closeness = Math.max(0, Math.min(1, ((cell.depth ?? depthLow) - depthLow) / depthSpan));
          const depthFactor = 0.55 + closeness * 0.9; // 0.55x (far) .. 1.45x (near)
          kStart = -back;
          kEnd = Math.max(1, Math.min(maxDepth + 1, Math.round(back * depthFactor)));
        } else {
          kStart = -back;
          kEnd = back;
        }
      }

      for (let k = kStart; k < kEnd; k++) {
        voxels.push({
          colorHex,
          cx: (x - width / 2 + 0.5) * size,
          cy: (j + 0.5) * size,
          cz: (k + 0.5) * size,
          i: x,
          j,
          k,
          zone: 'body',
        });
      }
    }
  }

  // Mosaic panels stay flat-faced; full-3D builds get 45° slope smoothing.
  return buildModelFromCells(voxels, size, { slopes: mode === 'volume' });
}

/** Portraits and people read best as flat relief panels, not inflated volumes. */
export function modeForLabel(label: string): PhotoBuildMode {
  return /person|portrait|face/i.test(label) ? 'relief' : 'volume';
}

export interface BuildPhotoOptions {
  face?: FacePoints | null;
  preserveFeatures?: boolean;
  category?: string;
}

export function buildPhotoModels(
  segmentation: Segmentation,
  label: string,
  mode: PhotoBuildMode = modeForLabel(label),
  style: PanelStyle = 'natural',
  options: BuildPhotoOptions = {},
): PhotoModels {
  const face = options.face ?? null;
  const preserve = options.preserveFeatures ?? false;
  return {
    category: options.category,
    hasDepth: mode === 'volume' && segmentation.depth != null,
    hasFace: !!face,
    label,
    mode,
    models: {
      balanced: voxelizeSegmentation(segmentation, 'balanced', mode, style, face, preserve),
      detailed: voxelizeSegmentation(segmentation, 'detailed', mode, style, face, preserve),
      efficient: voxelizeSegmentation(segmentation, 'efficient', mode, style, face, preserve),
    },
    style,
  };
}
