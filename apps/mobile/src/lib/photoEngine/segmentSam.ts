/**
 * SAM segmentation (web): SlimSAM via Transformers.js, prompted with the
 * centre of the user's selection — cuts the object out of ANY background,
 * unlike the classic border-colour segmenter which needs plain backdrops.
 *
 * The library and the ~35 MB model stream from CDN/HuggingFace on first use
 * and stay browser-cached. Metro cannot bundle Transformers.js, so the
 * module is imported at runtime via an evaluated dynamic import that the
 * bundler never sees. Output is a drop-in `Segmentation`, so the whole
 * downstream pipeline (posterize, dither, faces, depth, voxelize) is reused.
 */

import { Platform } from 'react-native';

import { connectedComponents, getCropPixels, SEGMENT_GRID, type Segmentation } from './segment';
import { loadTransformers, type TransformersModule } from './transformersRuntime';

const SAM_MODEL = 'Xenova/slimsam-77-uniform';

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SamBundle {
  model: {
    (inputs: unknown): Promise<{ pred_masks: unknown; iou_scores: { data: Float32Array } }>;
  };
  processor: {
    (image: unknown, opts: { input_points: number[][][] }): Promise<{
      original_sizes: unknown;
      reshaped_input_sizes: unknown;
    }>;
    post_process_masks: (
      masks: unknown,
      originalSizes: unknown,
      reshapedSizes: unknown,
    ) => Promise<Array<{ dims: number[]; data: Uint8Array | Float32Array }>>;
  };
  RawImage: TransformersModule['RawImage'];
}

let samPromise: Promise<SamBundle> | null = null;

async function getSam(): Promise<SamBundle> {
  if (!samPromise) {
    samPromise = (async () => {
      const transformers: TransformersModule = await loadTransformers();
      const [model, processor] = await Promise.all([
        transformers.SamModel.from_pretrained(SAM_MODEL, { dtype: 'q8' }),
        transformers.AutoProcessor.from_pretrained(SAM_MODEL),
      ]);
      return { model, processor, RawImage: transformers.RawImage } as unknown as SamBundle;
    })();
    samPromise.catch(() => {
      samPromise = null; // retry after network failures
    });
  }
  return samPromise;
}

export function isSamSupported() {
  return Platform.OS === 'web';
}

/**
 * Segment the selected region with SAM, prompted at the selection centre.
 * Returns a classic-compatible Segmentation, or null so the caller can fall
 * back to the border-colour segmenter.
 */
export async function samSegmentRegion(uri: string, region: Region): Promise<Segmentation | null> {
  if (!isSamSupported()) {
    return null;
  }

  try {
    const { model, processor, RawImage } = await getSam();
    const image = await RawImage.read(uri);

    // Prompt: centre of the user's selection, in full-image pixels.
    const pointX = (region.x + region.width / 2) * image.width;
    const pointY = (region.y + region.height / 2) * image.height;

    const inputs = await processor(image, { input_points: [[[pointX, pointY]]] });
    const outputs = await model(inputs);
    const masks = await processor.post_process_masks(
      (outputs as { pred_masks: unknown }).pred_masks,
      inputs.original_sizes,
      inputs.reshaped_input_sizes,
    );

    const scores = outputs.iou_scores.data;
    let best = 0;
    for (let index = 1; index < scores.length; index++) {
      if (scores[index]! > scores[best]!) best = index;
    }
    if ((scores[best] ?? 0) < 0.7) {
      return null; // low confidence — let the classic path try
    }

    const maskTensor = masks[0]!;
    const [maskH, maskW] = maskTensor.dims.slice(-2) as [number, number];
    const plane = maskH * maskW;
    const maskData = maskTensor.data;

    // Sample the full-image mask down to the region-relative grid.
    const grid = SEGMENT_GRID;
    const mask: boolean[] = new Array(grid * grid).fill(false);
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const px = Math.min(maskW - 1, Math.round((region.x + ((gx + 0.5) / grid) * region.width) * maskW));
        const py = Math.min(maskH - 1, Math.round((region.y + ((gy + 0.5) / grid) * region.height) * maskH));
        mask[gy * grid + gx] = !!maskData[best * plane + py * maskW + px];
      }
    }

    // Keep the largest component and fill interior holes (same as classic).
    const { labels, sizes } = connectedComponents(mask, grid);
    const biggest = sizes.indexOf(Math.max(0, ...sizes));
    for (let cell = 0; cell < mask.length; cell++) {
      mask[cell] = mask[cell]! && labels[cell] === biggest;
    }
    const background = mask.map((on) => !on);
    const { labels: bgLabels } = connectedComponents(background, grid);
    const borderLabels = new Set<number>();
    for (let index = 0; index < grid; index++) {
      for (const cell of [index, (grid - 1) * grid + index, index * grid, index * grid + grid - 1]) {
        if (background[cell]) borderLabels.add(bgLabels[cell]!);
      }
    }
    for (let cell = 0; cell < mask.length; cell++) {
      if (!mask[cell] && !borderLabels.has(bgLabels[cell]!)) {
        mask[cell] = true;
      }
    }

    const coverage = mask.filter(Boolean).length / mask.length;
    // eslint-disable-next-line no-console
    console.info('[sam] iou', (scores[best] ?? 0).toFixed(3), 'coverage', coverage.toFixed(3));
    if (coverage < 0.02) {
      return null;
    }

    const pixels = await getCropPixels(uri, region, grid);
    const colors: Array<[number, number, number] | null> = mask.map((on, cell) =>
      on ? [pixels[cell * 4]!, pixels[cell * 4 + 1]!, pixels[cell * 4 + 2]!] : null,
    );

    return { colors, coverage, grid, mask, region };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[sam] failed:', (error as Error)?.message ?? error);
    return null;
  }
}
