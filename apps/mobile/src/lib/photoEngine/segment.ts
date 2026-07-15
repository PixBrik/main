/**
 * Silhouette segmentation of the selected object region (web only).
 *
 * Classic-CV approach, deterministic and dependency free: the border ring of
 * the selected crop is sampled as the background colour model, foreground is
 * everything sufficiently far from it, then the largest connected component
 * is kept and interior holes are filled. Works best on the clean, contrasty
 * shots the capture screen coaches the user toward.
 */

export interface Segmentation {
  /** Mask grid, row-major, GRID×GRID. */
  mask: boolean[];
  /** Average crop colour per cell as [r, g, b], aligned with mask. */
  colors: Array<[number, number, number] | null>;
  grid: number;
  /** Fraction of the crop covered by the mask (sanity signal). */
  coverage: number;
  /** The photo region this segmentation covers (needed for depth alignment). */
  region: { x: number; y: number; width: number; height: number };
  /**
   * Relative closeness per cell from the depth model, aligned with mask.
   * undefined = not attempted yet, null = attempted but unavailable.
   */
  depth?: Float32Array | null;
  /** Face landmarks (region-relative), when a face model found one. */
  face?: import('./voxelizePhoto').FacePoints | null;
  /** Category decided at lock time (drives rebuild defaults). */
  categoryLabel?: string;
  preserveFeatures?: boolean;
}

export const SEGMENT_GRID = 56;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getCropPixels(uri: string, region: Region, grid: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = grid;
      canvas.height = grid;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('no 2d context'));
        return;
      }
      context.drawImage(
        image,
        region.x * image.naturalWidth,
        region.y * image.naturalHeight,
        region.width * image.naturalWidth,
        region.height * image.naturalHeight,
        0,
        0,
        grid,
        grid,
      );
      resolve(context.getImageData(0, 0, grid, grid).data);
    };
    image.onerror = reject;
    image.src = uri;
  });
}

function colorDistance(pixels: Uint8ClampedArray, index: number, mean: number[]) {
  const dr = pixels[index]! - mean[0]!;
  const dg = pixels[index + 1]! - mean[1]!;
  const db = pixels[index + 2]! - mean[2]!;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Flood fill on a boolean grid; returns component sizes and labels. */
export function connectedComponents(mask: boolean[], grid: number) {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const label = sizes.length;
    sizes.push(0);
    stack.push(start);
    labels[start] = label;
    while (stack.length) {
      const index = stack.pop()!;
      sizes[label]!++;
      const x = index % grid;
      const y = (index / grid) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
        const next = ny * grid + nx;
        if (mask[next] && labels[next] === -1) {
          labels[next] = label;
          stack.push(next);
        }
      }
    }
  }
  return { labels, sizes };
}

export async function segmentRegion(uri: string, region: Region, grid: number = SEGMENT_GRID): Promise<Segmentation> {
  const pixels = await getCropPixels(uri, region, grid);

  // Background model: mean colour of the crop's border ring.
  const border: number[] = [];
  for (let i = 0; i < grid; i++) {
    border.push(i, (grid - 1) * grid + i, i * grid, i * grid + grid - 1);
  }
  const mean = [0, 0, 0];
  for (const cell of border) {
    mean[0]! += pixels[cell * 4]!;
    mean[1]! += pixels[cell * 4 + 1]!;
    mean[2]! += pixels[cell * 4 + 2]!;
  }
  mean[0]! /= border.length;
  mean[1]! /= border.length;
  mean[2]! /= border.length;

  let deviation = 0;
  for (const cell of border) {
    deviation += colorDistance(pixels, cell * 4, mean);
  }
  deviation /= border.length;
  const threshold = Math.max(38, deviation * 2.4);

  const rough: boolean[] = new Array(grid * grid);
  for (let cell = 0; cell < grid * grid; cell++) {
    rough[cell] = colorDistance(pixels, cell * 4, mean) > threshold;
  }

  // Keep the largest foreground component only.
  const { labels, sizes } = connectedComponents(rough, grid);
  const biggest = sizes.indexOf(Math.max(0, ...sizes));
  const mask: boolean[] = rough.map((on, index) => on && labels[index] === biggest);

  // Fill interior holes: anything not reachable from the border is object.
  const background = mask.map((on) => !on);
  const { labels: bgLabels } = connectedComponents(background, grid);
  const borderLabels = new Set<number>();
  for (const cell of border) {
    if (background[cell]) borderLabels.add(bgLabels[cell]!);
  }
  for (let cell = 0; cell < mask.length; cell++) {
    if (!mask[cell] && !borderLabels.has(bgLabels[cell]!)) {
      mask[cell] = true;
    }
  }

  const colors: Array<[number, number, number] | null> = mask.map((on, cell) =>
    on ? [pixels[cell * 4]!, pixels[cell * 4 + 1]!, pixels[cell * 4 + 2]!] : null,
  );
  const coverage = mask.filter(Boolean).length / mask.length;

  return { colors, coverage, grid, mask, region };
}
