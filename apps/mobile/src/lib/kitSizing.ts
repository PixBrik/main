import type { BuildProfile, VoxelModel } from './voxelFox';

/** One standard catalog stud is 8 mm wide. */
export const STUD_PITCH_CM = 0.8;

/**
 * True-3D kit spans on the approved mesh's longest axis.
 *
 * The previous 40/64/88 grid produced roughly 32/51/70 cm sculptures. These
 * targets make the three proposals honest, gift-sized physical alternatives.
 * With standard bricks, a smaller kit necessarily carries fewer silhouette
 * samples; the UI calls this out instead of pretending size and detail are
 * independent.
 */
export const SCULPTURE_STUD_SPAN: Readonly<Record<BuildProfile, number>> = {
  efficient: 20,
  balanced: 32,
  detailed: 48,
};

export interface SculptureSizeOption {
  name: string;
  shortName: string;
  promise: string;
  targetLongestCm: number;
}

export const SCULPTURE_SIZE_OPTIONS: Readonly<Record<BuildProfile, SculptureSizeOption>> = {
  efficient: {
    name: 'Mini',
    promise: 'Smallest gift size',
    shortName: 'MINI',
    targetLongestCm: SCULPTURE_STUD_SPAN.efficient * STUD_PITCH_CM,
  },
  balanced: {
    name: 'Classic',
    promise: 'Best likeness / size balance',
    shortName: 'CLASSIC',
    targetLongestCm: SCULPTURE_STUD_SPAN.balanced * STUD_PITCH_CM,
  },
  detailed: {
    name: 'Showcase',
    promise: 'Most shape and surface detail',
    shortName: 'SHOWCASE',
    targetLongestCm: SCULPTURE_STUD_SPAN.detailed * STUD_PITCH_CM,
  },
};

export interface PhysicalDimensions {
  depthCm: number;
  heightCm: number;
  label: string;
  longestCm: number;
  widthCm: number;
}

/** Finished dimensions from occupied studs, using the model's real layer pitch. */
export function physicalDimensions(model: VoxelModel): PhysicalDimensions {
  if (!model.cells.length) {
    return { depthCm: 0, heightCm: 0, label: '—', longestCm: 0, widthCm: 0 };
  }
  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let maxJ = -Infinity;
  let minK = Infinity;
  let maxK = -Infinity;
  for (const cell of model.cells) {
    minI = Math.min(minI, cell.i);
    maxI = Math.max(maxI, cell.i);
    minJ = Math.min(minJ, cell.j);
    maxJ = Math.max(maxJ, cell.j);
    minK = Math.min(minK, cell.k);
    maxK = Math.max(maxK, cell.k);
  }
  const widthCm = (maxI - minI + 1) * STUD_PITCH_CM;
  const depthCm = (maxK - minK + 1) * STUD_PITCH_CM;
  const layerPitchCm = STUD_PITCH_CM * ((model.layerHeight ?? model.size) / model.size);
  const heightCm = (maxJ - minJ + 1) * layerPitchCm;
  const rounded = [widthCm, depthCm, heightCm].map((value) => Math.max(1, Math.round(value)));
  return {
    depthCm,
    heightCm,
    label: `${rounded[0]} × ${rounded[1]} × ${rounded[2]} cm`,
    longestCm: Math.max(widthCm, depthCm, heightCm),
    widthCm,
  };
}
