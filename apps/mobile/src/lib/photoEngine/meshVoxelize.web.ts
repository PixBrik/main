/**
 * Mesh → brick voxelizer (web). Turns a full 3D mesh (a GLB, e.g. produced by
 * an image-to-3D model) into our brick voxel grid — with real geometry on
 * every side and surface colour sampled from the mesh. This is the "back
 * half" of Tier-2: whatever produces the mesh (a hosted image-to-3D API, or a
 * downloaded model), this converts it to a buildable FotoBrik model.
 *
 * Approach: per-mesh BVH (three-mesh-bvh) for fast queries; a voxel is inside
 * when a ray cast from its centre crosses an odd number of triangles; surface
 * colour comes from the closest point on the mesh (vertex colours, then
 * texture UV sample, then material colour).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh';

import { buildModelFromCells, type VoxelCell, type VoxelModel } from '../voxelFox';
import { colorDistance, quantizeToCatalog } from './voxelizePhoto';

// Accelerate THREE.Mesh raycasts with the BVH extension.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

/** Target voxel resolution on the model's longest axis, per profile. */
const RES = { efficient: 28, balanced: 44, detailed: 64 } as const;
export type MeshProfile = keyof typeof RES;

interface PreparedMesh {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  textureData: { data: Uint8ClampedArray; width: number; height: number } | null;
  hasVertexColor: boolean;
  materialColor: THREE.Color;
}

function readTexture(material: THREE.Material): PreparedMesh['textureData'] {
  const map = (material as THREE.MeshStandardMaterial).map;
  const image = map?.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) | undefined;
  if (!image || !('width' in image) || !image.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width as number;
  canvas.height = image.height as number;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image as CanvasImageSource, 0, 0);
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, height: canvas.height, width: canvas.width };
}

function prepare(root: THREE.Object3D): PreparedMesh[] {
  root.updateWorldMatrix(true, true);
  const prepared: PreparedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld); // bake transform → world space
    const material = (Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material) as THREE.Material;
    // Raycast through a double-sided copy: parity counts EVERY wall crossing,
    // and a FrontSide source material would silently cull the exits.
    const raycastMaterial = material.clone();
    raycastMaterial.side = THREE.DoubleSide;
    const worldMesh = new THREE.Mesh(geometry, raycastMaterial);
    const bvh = new MeshBVH(geometry);
    (geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
    prepared.push({
      bvh,
      hasVertexColor: !!geometry.getAttribute('color'),
      materialColor: (material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color('#cccccc'),
      mesh: worldMesh,
      textureData: readTexture(material),
    });
  });
  return prepared;
}

const tempTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

/** Surface colour at a world point: vertex colour → texture → material colour. */
function surfaceColor(prep: PreparedMesh, point: THREE.Vector3): string {
  const hit = prep.bvh.closestPointToPoint(point, tempTarget);
  const geometry = prep.mesh.geometry;
  const faceIndex = (hit as { faceIndex?: number }).faceIndex ?? 0;
  const index = geometry.getIndex();
  const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

  if (prep.hasVertexColor) {
    const colors = geometry.getAttribute('color');
    const r = (colors.getX(a) + colors.getX(b) + colors.getX(c)) / 3;
    const g = (colors.getY(a) + colors.getY(b) + colors.getY(c)) / 3;
    const bl = (colors.getZ(a) + colors.getZ(b) + colors.getZ(c)) / 3;
    return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
  }
  if (prep.textureData) {
    const uv = geometry.getAttribute('uv');
    if (uv) {
      const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
      const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
      const tx = Math.min(prep.textureData.width - 1, Math.max(0, Math.floor(u * prep.textureData.width)));
      const ty = Math.min(prep.textureData.height - 1, Math.max(0, Math.floor((1 - v) * prep.textureData.height)));
      const offset = (ty * prep.textureData.width + tx) * 4;
      return `#${toHex(prep.textureData.data[offset]! / 255)}${toHex(prep.textureData.data[offset + 1]! / 255)}${toHex(prep.textureData.data[offset + 2]! / 255)}`;
    }
  }
  return `#${toHex(prep.materialColor.r)}${toHex(prep.materialColor.g)}${toHex(prep.materialColor.b)}`;
}

function toHex(value01: number): string {
  return Math.max(0, Math.min(255, Math.round(value01 * 255)))
    .toString(16)
    .padStart(2, '0');
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Drop stray voxels with ≤1 face-neighbours — ray-parity noise, not model. */
function despeckle(cells: VoxelCell[]): VoxelCell[] {
  const occupied = new Set(cells.map((cell) => `${cell.i},${cell.j},${cell.k}`));
  return cells.filter((cell) => {
    let neighbours = 0;
    for (const [dx, dy, dz] of NEIGHBOURS) {
      if (occupied.has(`${cell.i + dx},${cell.j + dy},${cell.k + dz}`)) neighbours++;
    }
    return neighbours > 1;
  });
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * Palette discipline for mesh builds — the reason photo builds look tidy and
 * raw mesh builds looked "messy": each voxel used to quantize its own texel
 * independently, producing hundreds of near-duplicate catalog colours with
 * no coherent zones. Same recipe as the photo pipeline: deterministic
 * k-means over the sampled colours, a conservative 3D majority smoothing
 * pass (strict ≥4-of-6 vote, so small features like eyes survive), then one
 * catalog colour per cluster.
 */
function posterizeVoxelColors(cells: VoxelCell[], paletteSize = 10): void {
  if (!cells.length) return;
  const samples: Rgb[] = cells.map((cell) => hexToRgb(cell.colorHex ?? '#cccccc'));

  const k = Math.min(paletteSize, samples.length);
  const byLuma = [...samples].sort(
    (a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11),
  );
  let centroids: Rgb[] = Array.from({ length: k }, (_, index) => {
    const pick = byLuma[Math.floor(((index + 0.5) / k) * byLuma.length)]!;
    return [...pick] as Rgb;
  });

  const assign = new Int32Array(samples.length);
  for (let iteration = 0; iteration < 8; iteration++) {
    for (let index = 0; index < samples.length; index++) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c++) {
        const s = samples[index]!;
        const distance = colorDistance(s[0], s[1], s[2], centroids[c]![0], centroids[c]![1], centroids[c]![2]);
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
      const s = samples[index]!;
      sum[0]! += s[0];
      sum[1]! += s[1];
      sum[2]! += s[2];
      sum[3]! += 1;
    }
    centroids = centroids.map((old, c) => {
      const sum = sums[c]!;
      return sum[3]! > 0 ? ([sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!] as Rgb) : old;
    });
  }

  // Conservative 3D majority smoothing: a cell only changes cluster when a
  // strict majority of its 6-neighbourhood (≥4) agrees on another cluster.
  const indexByCoord = new Map<string, number>();
  cells.forEach((cell, index) => indexByCoord.set(`${cell.i},${cell.j},${cell.k}`, index));
  const smoothed = new Int32Array(assign);
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    const votes = new Map<number, number>();
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const neighbour = indexByCoord.get(`${cell.i + dx},${cell.j + dy},${cell.k + dz}`);
      if (neighbour !== undefined) {
        const cluster = assign[neighbour]!;
        votes.set(cluster, (votes.get(cluster) ?? 0) + 1);
      }
    }
    for (const [cluster, count] of votes) {
      if (cluster !== assign[index] && count >= 4) {
        smoothed[index] = cluster;
        break;
      }
    }
  }

  const clusterHex = centroids.map((centroid) => quantizeToCatalog(centroid[0], centroid[1], centroid[2]));
  for (let index = 0; index < cells.length; index++) {
    cells[index]!.colorHex = clusterHex[smoothed[index]!]!;
  }
}

/** Progress callback for the (potentially long) voxelization pass. */
export type VoxelizeProgressFn = (fraction: number) => void;

/**
 * Ray directions for the parity vote — each tilted a hair off its axis.
 * Exactly axis-aligned rays from a regular grid skim flat axis-aligned faces
 * and shared triangle edges (the duck's flat bottom, for instance), and every
 * tangent/duplicate hit corrupts the crossing count. A tiny irrational tilt
 * makes those degenerate alignments impossible while leaving the crossing
 * topology of interior points unchanged.
 */
const RAY_AXES = [
  new THREE.Vector3(1, 0.00017, 0.00031).normalize(),
  new THREE.Vector3(0.00031, 1, 0.00017).normalize(),
  new THREE.Vector3(0.00017, 0.00031, 1).normalize(),
] as const;

/**
 * Crossing count robust to duplicate hits: a ray passing through an edge
 * shared by two triangles reports two intersections at the same distance —
 * counting both flips the parity. Hits arrive sorted by distance; collapse
 * any run closer together than epsilon into one crossing.
 */
function countCrossings(hits: ReadonlyArray<{ distance: number }>, epsilon: number): number {
  let crossings = 0;
  let lastDistance = -Infinity;
  for (const hit of hits) {
    if (hit.distance - lastDistance > epsilon) {
      crossings++;
      lastDistance = hit.distance;
    }
  }
  return crossings;
}

/**
 * Yield to the event loop so long grids never freeze the tab. Uses a
 * MessageChannel tick rather than setTimeout: background tabs throttle
 * timers to ≥1s each, which would stretch a 100-slice grid to minutes,
 * while channel messages keep firing at full speed.
 */
const tickChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
function nextTick(): Promise<void> {
  if (!tickChannel) {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    tickChannel.port1.onmessage = () => resolve();
    tickChannel.port2.postMessage(null);
  });
}

/**
 * Voxelize prepared meshes into a FotoBrik model.
 *
 * Async + chunked: the grid is processed in slices with an event-loop yield
 * between them, so high resolutions stay responsive instead of freezing the
 * tab (which is why photo builds used to be capped at res 28).
 *
 * Robust inside-test: generated meshes (Tripo/Meshy) are often slightly
 * non-manifold, and a single-axis ray-parity test turns every crack into a
 * column of missing or phantom voxels. Casting along all three axes and
 * majority-voting the parity makes the fill robust to local mesh defects.
 */
async function voxelizeMeshes(
  prepared: PreparedMesh[],
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
): Promise<VoxelModel> {
  const box = new THREE.Box3();
  for (const prep of prepared) box.union(new THREE.Box3().setFromObject(prep.mesh));
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const voxel = maxAxis / RES[profile];
  const worldSize = 6.3 / RES[profile]; // match built-in models' scale

  const nx = Math.max(1, Math.ceil(size.x / voxel));
  const ny = Math.max(1, Math.ceil(size.y / voxel));
  const nz = Math.max(1, Math.ceil(size.z / voxel));

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  // Collapse duplicate hits (shared edges) without merging genuinely thin
  // double walls — well below a voxel, well above float noise.
  const crossingEpsilon = maxAxis * 1e-6;
  const meshes = prepared.map((prep) => prep.mesh);
  const centre = new THREE.Vector3();
  const cells: VoxelCell[] = [];

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        centre.set(
          box.min.x + (ix + 0.5) * voxel,
          box.min.y + (iy + 0.5) * voxel,
          box.min.z + (iz + 0.5) * voxel,
        );
        // 2-of-3 axis parity vote.
        let insideVotes = 0;
        for (const axis of RAY_AXES) {
          raycaster.set(centre, axis);
          const hits = raycaster.intersectObjects(meshes, false);
          if (countCrossings(hits, crossingEpsilon) % 2 === 1) insideVotes++;
          // Early exit: verdict already decided either way.
          if (insideVotes === 2) break;
        }
        if (insideVotes < 2) continue;

        // Nearest surface across all meshes for colour.
        let best = prepared[0]!;
        let bestDist = Infinity;
        for (const prep of prepared) {
          const hit = prep.bvh.closestPointToPoint(centre, { point: new THREE.Vector3() } as never);
          const distance = (hit as { distance?: number }).distance ?? Infinity;
          if (distance < bestDist) {
            bestDist = distance;
            best = prep;
          }
        }
        cells.push({
          colorHex: surfaceColor(best, centre),
          cx: (ix - nx / 2 + 0.5) * worldSize,
          cy: (iy + 0.5) * worldSize,
          cz: (iz - nz / 2 + 0.5) * worldSize,
          i: ix,
          j: iy,
          k: iz,
          zone: 'body',
        });
      }
    }
    // One yield per x-slice keeps the UI (loader, progress) alive.
    onProgress?.((ix + 1) / nx);
    await nextTick();
  }

  for (const prep of prepared) {
    (prep.mesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
  }
  const clean = despeckle(cells);
  posterizeVoxelColors(clean);
  return buildModelFromCells(clean, worldSize, { slopes: true });
}

/** Voxelize an already-loaded GLB ArrayBuffer at all three profiles. */
export async function voxelizeGlb(buffer: ArrayBuffer): Promise<Record<MeshProfile, VoxelModel>> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const prepared = prepare(gltf.scene);
  if (!prepared.length) {
    throw new Error('no meshes in model');
  }
  return {
    balanced: await voxelizeMeshes(prepared, 'balanced'),
    detailed: await voxelizeMeshes(prepared, 'detailed'),
    efficient: await voxelizeMeshes(prepared, 'efficient'),
  };
}

/** Voxelize a GLB at a single profile (fast — library picker uses this). */
export async function voxelizeGlbOne(
  buffer: ArrayBuffer,
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
): Promise<VoxelModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const prepared = prepare(gltf.scene);
  if (!prepared.length) {
    throw new Error('no meshes in model');
  }
  return voxelizeMeshes(prepared, profile, onProgress);
}

export async function voxelizeGlbUrlOne(
  url: string,
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
): Promise<VoxelModel> {
  const buffer = await (await fetch(url)).arrayBuffer();
  return voxelizeGlbOne(buffer, profile, onProgress);
}

/** Fetch a GLB URL and voxelize it. */
export async function voxelizeGlbUrl(url: string): Promise<Record<MeshProfile, VoxelModel>> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return voxelizeGlb(buffer);
}

export const isMeshVoxelizeSupported = true;
