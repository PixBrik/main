/** Native stub — LDraw product renders are generated on web only. */

export const LDU_PER_STUD = 20;
export const LDU_PER_BRICK = 24;

export interface BrickPlacementLike {
  colorId: number | string;
  i: number;
  j: number;
  k: number;
  part: string;
  spanI?: number;
  spanK?: number;
  facing?: number;
  shape?: string;
}

export interface LDrawRenderOptions {
  ldrawBase: string;
  colorHexById: Record<string, string>;
  fallbackHex?: string;
  frames?: number;
  width?: number;
  height?: number;
  light?: boolean;
  elevation?: number;
  yaw?: number;
  monochrome?: string;
}

export async function renderLDrawTurntable(
  _placements: readonly BrickPlacementLike[],
  _options: LDrawRenderOptions,
): Promise<string[]> {
  return [];
}
