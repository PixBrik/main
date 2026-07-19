/**
 * Pre-rendered brick turntable: four exact 90° views of a voxel model as PNG
 * data URLs. Published with each library master so the shop can show the real
 * brick kit from every side instantly — no client-side voxelization, no
 * WebGL context, no multi-megabyte GLB download while browsing.
 */

import { facesToPngDataUrl, fitFacesToBox } from './fitFaces';
import type { VoxelModel } from './voxelFox';
import { buildRenderFaces } from './voxelRender';

export const TURNTABLE_FRAME_WIDTH = 560;
export const TURNTABLE_FRAME_HEIGHT = 420;

/** Rotate a voxel model 90° about the vertical axis on exact grid positions. */
function rotateYaw90(model: VoxelModel): VoxelModel {
  let maxK = 0;
  for (const cell of model.cells) maxK = Math.max(maxK, cell.k);
  const { size } = model;
  const rotate = <T extends { cx: number; cz: number; i: number; k: number }>(cell: T): T => {
    const i = maxK - cell.k;
    const k = cell.i;
    return { ...cell, cx: i * size + size / 2, cz: k * size + size / 2, i, k };
  };
  return {
    ...model,
    cells: model.cells.map(rotate),
    shell: model.shell.map(rotate),
  };
}

/**
 * Render front/right/back/left brick views. Slope facings are orientation
 * metadata that a 90° cell rotation does not remap, so wedges may render as
 * plain bricks in rotated frames — acceptable for a shop preview.
 */
export function renderBrickTurntable(
  model: VoxelModel,
  accent: string,
  frames = 4,
  width = TURNTABLE_FRAME_WIDTH,
  height = TURNTABLE_FRAME_HEIGHT,
): string[] {
  const out: string[] = [];
  let current = model;
  for (let frame = 0; frame < frames; frame += 1) {
    if (frame > 0) current = rotateYaw90(current);
    const probe = buildRenderFaces(0.55, accent, current, { baseY: 0, centerX: 0, scale: 1 });
    const png = facesToPngDataUrl(fitFacesToBox(probe, width, height), width, height, 2);
    if (png) out.push(png);
  }
  return out;
}
