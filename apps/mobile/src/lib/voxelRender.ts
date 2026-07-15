/**
 * Shared projected-voxel rendering: turns the voxel fox shell into
 * depth-sorted SVG polygon faces for a given yaw. Used by the interactive
 * result viewer and the animated home-screen hero.
 */

import { FACE_DIRECTIONS, type Voxel, type VoxelModel } from './voxelFox';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface RenderFace {
  depth: number;
  fill: string;
  id: string;
  points: string;
}

export interface Projection {
  centerX: number;
  baseY: number;
  scale: number;
}

const BODY_TONES = ['#E96632', '#F0773F', '#DE5E2B', '#F57C46'] as const;

const ZONE_COLORS: Record<Exclude<Voxel['zone'], 'body' | 'accent'>, string> = {
  cream: '#E8E2D5',
  dark: '#171B26',
  mint: '#8DF5E5',
};

/** Corner indices per face, in the same order as FACE_DIRECTIONS (top/front/back/right/left). */
const FACE_CORNERS = [
  [3, 2, 6, 7],
  [4, 5, 6, 7],
  [0, 1, 2, 3],
  [1, 5, 6, 2],
  [0, 3, 7, 4],
] as const;

/**
 * Slope (45° wedge) geometry per descent direction (FACE_DIRECTIONS index).
 * `slant` is the ramp quad (top-back edge → bottom-front edge), `skip` are
 * the cube faces the ramp replaces, `sides` are the triangular flanks keyed
 * by the cube face they replace.
 */
const SLOPE_GEOM: Record<number, { slant: number[]; skip: number[]; sides: Record<number, number[]> }> = {
  1: { skip: [0, 1], sides: { 3: [1, 2, 5], 4: [0, 3, 4] }, slant: [3, 2, 5, 4] }, // toward +z
  2: { skip: [0, 2], sides: { 3: [5, 6, 1], 4: [4, 7, 0] }, slant: [7, 6, 1, 0] }, // toward -z
  3: { skip: [0, 3], sides: { 1: [4, 7, 5], 2: [0, 3, 1] }, slant: [3, 7, 5, 1] }, // toward +x
  4: { skip: [0, 4], sides: { 1: [5, 6, 4], 2: [1, 2, 0] }, slant: [2, 6, 4, 0] }, // toward -x
};

const SQRT_HALF = Math.SQRT1_2;

/** Unrotated normal of a slope's ramp face. */
function slopeNormal(facing: number): Point3D {
  const dir = FACE_DIRECTIONS[facing]!;
  return { x: dir.x * SQRT_HALF, y: SQRT_HALF, z: dir.z * SQRT_HALF };
}

export function adjustHexColor(hex: string, amount: number) {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hex;
  }

  const target = amount >= 0 ? 255 : 0;
  const weight = Math.abs(amount);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.round(channel + (target - channel) * weight)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${channels.join('')}`;
}

/** Deterministic per-brick tone so the body reads as many individual pieces. */
function bodyTone(voxel: Voxel) {
  const hash = Math.abs(voxel.i * 73856093 + voxel.j * 19349663 + voxel.k * 83492791);
  return BODY_TONES[hash % BODY_TONES.length]!;
}

/** Resolved base colour of a voxel — shared by the SVG and WebGL renderers. */
export function voxelBaseColor(voxel: Voxel, accent: string): string {
  if (voxel.colorHex) {
    const hash = Math.abs(voxel.i * 73856093 + voxel.j * 19349663 + voxel.k * 83492791);
    return adjustHexColor(voxel.colorHex, ((hash % 5) - 2) * 0.022);
  }
  if (voxel.zone === 'accent') return accent;
  if (voxel.zone === 'body') return bodyTone(voxel);
  return ZONE_COLORS[voxel.zone];
}

export function rotatePoint(point: Point3D, yaw: number): Point3D {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: point.x * cosine - point.z * sine,
    y: point.y,
    z: point.x * sine + point.z * cosine,
  };
}

function projectPoint(point: Point3D, projection: Projection) {
  return {
    x: projection.centerX + point.x * projection.scale,
    y: projection.baseY - point.y * projection.scale + point.z * projection.scale * 0.28,
  };
}

function voxelCorners(voxel: Voxel, size: number): Point3D[] {
  const half = size / 2;
  const minX = voxel.cx - half;
  const maxX = voxel.cx + half;
  const minY = voxel.cy - half;
  const maxY = voxel.cy + half;
  const minZ = voxel.cz - half;
  const maxZ = voxel.cz + half;

  return [
    { x: minX, y: minY, z: minZ },
    { x: maxX, y: minY, z: minZ },
    { x: maxX, y: maxY, z: minZ },
    { x: minX, y: maxY, z: minZ },
    { x: minX, y: minY, z: maxZ },
    { x: maxX, y: minY, z: maxZ },
    { x: maxX, y: maxY, z: maxZ },
    { x: minX, y: maxY, z: maxZ },
  ];
}

export function buildRenderFaces(
  yaw: number,
  accent: string,
  model: VoxelModel,
  projection: Projection,
): RenderFace[] {
  const faces: RenderFace[] = [];

  // All voxels share the same five face normals, so visibility and shade are
  // computed once per frame instead of once per face.
  const faceVisibility = FACE_DIRECTIONS.map((normal) => {
    const rotated = rotatePoint(normal, yaw);
    return {
      light: normal.y === 1 ? 0.2 : rotated.x > 0 ? -0.08 : -0.24,
      visible: rotated.z + rotated.y * 0.48 > 0.025,
    };
  });

  for (const voxel of model.shell) {
    let hasVisibleFace = false;
    for (let face = 0; face < FACE_DIRECTIONS.length; face += 1) {
      if (voxel.exposed[face] && faceVisibility[face]!.visible) {
        hasVisibleFace = true;
        break;
      }
    }
    if (!hasVisibleFace) {
      continue;
    }

    const baseColor = voxelBaseColor(voxel, accent);
    const corners = voxelCorners(voxel, model.size).map((point) => rotatePoint(point, yaw));
    const slope = voxel.shape === 'slope' && voxel.facing ? SLOPE_GEOM[voxel.facing] : null;

    const pushFace = (cornerIdx: readonly number[], light: number, id: string) => {
      const vertices = cornerIdx.map((index) => corners[index]!);
      const projected = vertices.map((point) => projectPoint(point, projection));
      const averageDepth =
        vertices.reduce((total, point) => total + point.z + point.y * 0.34, 0) / vertices.length;
      faces.push({
        depth: averageDepth,
        fill: adjustHexColor(baseColor, light),
        id,
        points: projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
      });
    };

    if (slope) {
      // Ramp face replaces the top + descent faces.
      const rotatedNormal = rotatePoint(slopeNormal(voxel.facing!), yaw);
      if (rotatedNormal.z + rotatedNormal.y * 0.48 > 0.025) {
        pushFace(slope.slant, 0.12, `${voxel.i}:${voxel.j}:${voxel.k}:s`);
      }
    }

    for (let face = 0; face < FACE_DIRECTIONS.length; face += 1) {
      const visibility = faceVisibility[face]!;
      if (!voxel.exposed[face] || !visibility.visible) {
        continue;
      }
      if (slope) {
        if (slope.skip.includes(face)) continue;
        const triangle = slope.sides[face];
        if (triangle) {
          pushFace(triangle, visibility.light, `${voxel.i}:${voxel.j}:${voxel.k}:${face}`);
          continue;
        }
      }
      pushFace(FACE_CORNERS[face]!, visibility.light, `${voxel.i}:${voxel.j}:${voxel.k}:${face}`);
    }
  }

  return faces.sort((first, second) => first.depth - second.depth);
}
