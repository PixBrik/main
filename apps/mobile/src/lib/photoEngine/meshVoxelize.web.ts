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

import {
  BRICK_HEIGHT_RATIO,
  buildModelFromCells,
  type VoxelCell,
  type VoxelModel,
} from '../voxelFox';
import { colorizeMeshCells, type MeshBrickColorStyle } from './meshFidelity';
import { colorDistance } from './voxelizePhoto';
import { SCULPTURE_STUD_SPAN } from '../kitSizing';

// Accelerate THREE.Mesh raycasts with the BVH extension.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

/** Target standard-brick studs on the model's longest axis, per kit size. */
const RES = SCULPTURE_STUD_SPAN;
export type MeshProfile = keyof typeof RES;

export interface MeshVoxelizeOptions {
  /** Natural catalogue colours by default; `bw` is a five-tone neutral ramp. */
  colorStyle?: MeshBrickColorStyle;
}

interface PreparedMaterial {
  materialColor: THREE.Color;
  textureData: {
    data: Uint8ClampedArray;
    height: number;
    texture: THREE.Texture;
    width: number;
  } | null;
}

interface PreparedMesh {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  bounds: THREE.Box3;
  hasVertexColor: boolean;
  materials: PreparedMaterial[];
}

function readTexture(material: THREE.Material): PreparedMaterial['textureData'] {
  const map = (material as THREE.MeshStandardMaterial).map;
  if (!map) return null;
  const image = map.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) | undefined;
  if (!image || !('width' in image) || !image.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width as number;
  canvas.height = image.height as number;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image as CanvasImageSource, 0, 0);
  map.updateMatrix();
  return {
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    height: canvas.height,
    texture: map,
    width: canvas.width,
  };
}

function prepare(root: THREE.Object3D): PreparedMesh[] {
  root.updateWorldMatrix(true, true);
  const prepared: PreparedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld); // bake transform → world space
    geometry.computeBoundingBox();
    const sourceMaterials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    // Raycast through a double-sided copy: parity counts EVERY wall crossing,
    // and a FrontSide source material would silently cull the exits.
    const raycastMaterials = sourceMaterials.map((material) => {
      const copy = material.clone();
      copy.side = THREE.DoubleSide;
      return copy;
    });
    const worldMesh = new THREE.Mesh(geometry, raycastMaterials.length === 1 ? raycastMaterials[0]! : raycastMaterials);
    const bvh = new MeshBVH(geometry);
    (geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
    prepared.push({
      bvh,
      bounds: geometry.boundingBox!.clone(),
      hasVertexColor: !!geometry.getAttribute('color'),
      materials: sourceMaterials.map((material) => ({
        materialColor: (material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color('#cccccc'),
        textureData: readTexture(material),
      })),
      mesh: worldMesh,
    });
  });
  return prepared;
}

const tempTarget = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const triA = new THREE.Vector3();
const triB = new THREE.Vector3();
const triC = new THREE.Vector3();
const baryCoord = new THREE.Vector3();
const sampledUv = new THREE.Vector2();
const sampledColor = new THREE.Color();

function materialForFace(prep: PreparedMesh, faceIndex: number): PreparedMaterial {
  const elementOffset = faceIndex * 3;
  const group = prep.mesh.geometry.groups.find(
    (candidate) => elementOffset >= candidate.start && elementOffset < candidate.start + candidate.count,
  );
  return prep.materials[group?.materialIndex ?? 0] ?? prep.materials[0]!;
}

/**
 * Surface colour at a world point: vertex colour → texture → material colour.
 * Attributes are interpolated at the EXACT closest point via barycentric
 * coordinates — face-centroid averaging (the old way) blurs textures by up to
 * half a triangle, which on photoreal AI textures muddied every feature edge.
 */
function surfaceColor(prep: PreparedMesh, point: THREE.Vector3): string {
  const hit = prep.bvh.closestPointToPoint(point, tempTarget);
  const geometry = prep.mesh.geometry;
  const faceIndex = (hit as { faceIndex?: number } | null)?.faceIndex ?? 0;
  const material = materialForFace(prep, faceIndex);
  const index = geometry.getIndex();
  const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

  // Barycentric weights of the closest point inside its triangle; centroid
  // weights as the degenerate-triangle fallback.
  let wa = 1 / 3, wb = 1 / 3, wc = 1 / 3;
  if (hit) {
    const position = geometry.getAttribute('position');
    triA.fromBufferAttribute(position, a);
    triB.fromBufferAttribute(position, b);
    triC.fromBufferAttribute(position, c);
    const bary = THREE.Triangle.getBarycoord(tempTarget.point, triA, triB, triC, baryCoord);
    if (bary) {
      // Inset slightly toward the triangle interior: closest points land
      // EXACTLY on edges constantly, and on UV-seam edges the interpolated
      // UV falls one texel outside the texture island into atlas padding
      // (black/green bleed — the duck's beak sampled black this way).
      const inset = 0.88;
      const pad = (1 - inset) / 3;
      wa = bary.x * inset + pad;
      wb = bary.y * inset + pad;
      wc = bary.z * inset + pad;
    }
  }

  // THREE keeps material factors and vertex colours in linear working space.
  // Compose every base-colour contribution exactly as the GLB renderer does,
  // then convert once to sRGB for catalogue matching.
  sampledColor.copy(material.materialColor);
  if (prep.hasVertexColor) {
    const colors = geometry.getAttribute('color');
    const r = colors.getX(a) * wa + colors.getX(b) * wb + colors.getX(c) * wc;
    const g = colors.getY(a) * wa + colors.getY(b) * wb + colors.getY(c) * wc;
    const bl = colors.getZ(a) * wa + colors.getZ(b) * wb + colors.getZ(c) * wc;
    sampledColor.r *= r;
    sampledColor.g *= g;
    sampledColor.b *= bl;
  }
  if (material.textureData) {
    const uv = geometry.getAttribute('uv');
    if (uv) {
      const u = uv.getX(a) * wa + uv.getX(b) * wb + uv.getX(c) * wc;
      const v = uv.getY(a) * wa + uv.getY(b) * wb + uv.getY(c) * wc;
      sampledUv.set(u, v);
      // Respect KHR_texture_transform, repeat/clamp and GLTFLoader's flipY.
      // The former unconditional (1-v) read AI texture atlases upside-down.
      material.textureData.texture.transformUv(sampledUv);
      const tx = Math.min(
        material.textureData.width - 1,
        Math.max(0, Math.floor(sampledUv.x * material.textureData.width)),
      );
      const ty = Math.min(
        material.textureData.height - 1,
        Math.max(0, Math.floor(sampledUv.y * material.textureData.height)),
      );
      const offset = (ty * material.textureData.width + tx) * 4;
      const textureColor = new THREE.Color(
        material.textureData.data[offset]! / 255,
        material.textureData.data[offset + 1]! / 255,
        material.textureData.data[offset + 2]! / 255,
      );
      if (material.textureData.texture.colorSpace === THREE.SRGBColorSpace) {
        textureColor.convertSRGBToLinear();
      }
      sampledColor.multiply(textureColor);
    }
  }
  sampledColor.convertLinearToSRGB();
  return `#${toHex(sampledColor.r)}${toHex(sampledColor.g)}${toHex(sampledColor.b)}`;
}

function toHex(value01: number): string {
  return Math.max(0, Math.min(255, Math.round(value01 * 255)))
    .toString(16)
    .padStart(2, '0');
}

/** Jitter pattern for supersampled shell colours (fractions of a voxel). */
const SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [0.3, 0, 0], [-0.3, 0, 0],
  [0, 0.3, 0], [0, -0.3, 0],
  [0, 0, 0.3], [0, 0, -0.3],
];
const samplePoint = new THREE.Vector3();
const nearestProbe = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

function nearestPrep(prepared: PreparedMesh[], point: THREE.Vector3): PreparedMesh {
  let best = prepared[0]!;
  let bestDist = Infinity;
  for (const prep of prepared) {
    // Skip a BVH walk when this mesh part's bounds are already farther away
    // than the best surface found so far.
    if (prep.bounds.distanceToPoint(point) >= bestDist) continue;
    const hit = prep.bvh.closestPointToPoint(point, nearestProbe as never);
    const distance = (hit as { distance?: number } | null)?.distance ?? Infinity;
    if (distance < bestDist) {
      bestDist = distance;
      best = prep;
    }
  }
  return best;
}

/**
 * Supersampled colour for a VISIBLE (shell) voxel: seven jittered surface
 * samples, keep the redmean-medoid. One sample per voxel aliases hard on
 * photoreal AI textures — a single stray texel (compression noise, a seam
 * pixel) becomes a whole brick; the medoid ignores outliers while landing on
 * a colour that genuinely exists in the texture (an average would invent
 * in-between colours no catalog brick matches).
 */
function shellColor(
  prepared: PreparedMesh[],
  centre: THREE.Vector3,
  voxel: number,
  voxelHeight = voxel,
): string {
  const hexes: string[] = [];
  for (const [ox, oy, oz] of SAMPLE_OFFSETS) {
    samplePoint.set(
      centre.x + ox * voxel,
      centre.y + oy * voxelHeight,
      centre.z + oz * voxel,
    );
    const prep = prepared.length === 1 ? prepared[0]! : nearestPrep(prepared, samplePoint);
    hexes.push(surfaceColor(prep, samplePoint));
  }
  const rgbs = hexes.map(hexToRgb);
  let bestIndex = 0;
  let bestSum = Infinity;
  for (let i = 0; i < rgbs.length; i++) {
    let sum = 0;
    for (let j = 0; j < rgbs.length; j++) {
      if (i === j) continue;
      sum += colorDistance(rgbs[i]![0], rgbs[i]![1], rgbs[i]![2], rgbs[j]![0], rgbs[j]![1], rgbs[j]![2]);
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestIndex = i;
    }
  }
  return hexes[bestIndex]!;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

/** Progress callback for the (potentially long) voxelization pass. */
export type VoxelizeProgressFn = (fraction: number) => void;

/** Occupancy states for the voxel grid classification. */
const UNKNOWN = 0;
const SHELL = 1;
const OUTSIDE = 2;

/**
 * Yield to the event loop so long grids never freeze the tab. Uses a
 * MessageChannel tick rather than setTimeout: background tabs throttle
 * timers to ≥1s each, which would stretch a 100-slice grid to minutes,
 * while channel messages keep firing at full speed.
 */
const tickChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
// Node's MessagePort keeps the offline converter tests alive unless unref'd;
// browsers do not expose this method.
(tickChannel?.port1 as MessagePort & { unref?: () => void } | undefined)?.unref?.();
(tickChannel?.port2 as MessagePort & { unref?: () => void } | undefined)?.unref?.();
function nextTick(): Promise<void> {
  // MessagePort.onmessage re-refs the port in Node. Offline converter tests
  // use a timer tick instead so the process exits cleanly after verification.
  if (!tickChannel || typeof window === 'undefined') {
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
 * Inside-test: exact triangle/voxel shell + outside flood fill, NOT ray
 * parity. AI meshes are routinely non-watertight, where parity collapses.
 * BVH triangle-box overlap preserves the approved silhouette (including thin
 * diagonals); a six-connected border flood then fills only genuinely enclosed
 * space. Large openings remain honest hollow shells instead of changing the
 * visible shape.
 */
async function voxelizeMeshes(
  prepared: PreparedMesh[],
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<VoxelModel> {
  const box = new THREE.Box3();
  for (const prep of prepared) box.union(prep.bounds);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const voxel = maxAxis / RES[profile];
  const voxelHeight = voxel * BRICK_HEIGHT_RATIO;
  const worldSize = 6.3 / RES[profile]; // match built-in models' scale
  const worldLayerHeight = worldSize * BRICK_HEIGHT_RATIO;

  const nx = Math.max(1, Math.ceil(size.x / voxel));
  const ny = Math.max(1, Math.ceil(size.y / voxelHeight));
  const nz = Math.max(1, Math.ceil(size.z / voxel));
  const boxCenter = box.getCenter(new THREE.Vector3());
  const gridMin = new THREE.Vector3(
    boxCenter.x - (nx * voxel) / 2,
    boxCenter.y - (ny * voxelHeight) / 2,
    boxCenter.z - (nz * voxel) / 2,
  );
  const total = nx * ny * nz;
  const grid = new Uint8Array(total); // UNKNOWN | SHELL | OUTSIDE
  const at = (ix: number, iy: number, iz: number) => (ix * ny + iy) * nz + iz;

  const centre = new THREE.Vector3();
  const voxelBox = new THREE.Box3();
  const voxelBoxSize = new THREE.Vector3(voxel, voxelHeight, voxel).multiplyScalar(1.000001);
  const identity = new THREE.Matrix4();

  // Pass 1 — exact triangle/voxel overlap. This supercover retains thin and
  // diagonal features without the silhouette inflation of a centre-radius
  // test; the BVH keeps the box queries bounded.
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        centre.set(
          gridMin.x + (ix + 0.5) * voxel,
          gridMin.y + (iy + 0.5) * voxelHeight,
          gridMin.z + (iz + 0.5) * voxel,
        );
        voxelBox.setFromCenterAndSize(centre, voxelBoxSize);
        for (const prep of prepared) {
          // Complex GLBs split a subject into many small mesh parts. Reject
          // parts outside this voxel before the more expensive BVH query.
          if (!prep.bounds.intersectsBox(voxelBox)) continue;
          if (prep.bvh.intersectsBox(voxelBox, identity)) {
            grid[at(ix, iy, iz)] = SHELL;
            break;
          }
        }
      }
    }
    // One yield per x-slice keeps the UI (loader, progress) alive.
    onProgress?.(((ix + 1) / nx) * 0.6);
    await nextTick();
  }

  // Pass 2 — flood OUTSIDE from every border voxel through non-shell space
  // (6-connected BFS; synchronous but trivial — no geometry queries).
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (ix: number, iy: number, iz: number) => {
    const index = at(ix, iy, iz);
    if (grid[index] === UNKNOWN) {
      grid[index] = OUTSIDE;
      queue[tail++] = index;
    }
  };
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      seed(ix, iy, 0);
      seed(ix, iy, nz - 1);
    }
    for (let iz = 0; iz < nz; iz++) {
      seed(ix, 0, iz);
      seed(ix, ny - 1, iz);
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      seed(0, iy, iz);
      seed(nx - 1, iy, iz);
    }
  }
  while (head < tail) {
    const index = queue[head++]!;
    const iz = index % nz;
    const iy = Math.floor(index / nz) % ny;
    const ix = Math.floor(index / (ny * nz));
    if (ix > 0) seed(ix - 1, iy, iz);
    if (ix < nx - 1) seed(ix + 1, iy, iz);
    if (iy > 0) seed(ix, iy - 1, iz);
    if (iy < ny - 1) seed(ix, iy + 1, iz);
    if (iz > 0) seed(ix, iy, iz - 1);
    if (iz < nz - 1) seed(ix, iy, iz + 1);
  }

  // Pass 3 — keep shell + interior (everything the flood never reached).
  // Triangle-touched voxels get supersampled colour. After occupancy is known,
  // only the actually exposed subset trains the visible palette; buried
  // triangle walls and filled interiors receive the dominant surface colour.
  const cells: VoxelCell[] = [];
  const surfaceCells: VoxelCell[] = [];
  const interiorCells: VoxelCell[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const state = grid[at(ix, iy, iz)];
        if (state === OUTSIDE) continue;
        centre.set(
          gridMin.x + (ix + 0.5) * voxel,
          gridMin.y + (iy + 0.5) * voxelHeight,
          gridMin.z + (iz + 0.5) * voxel,
        );
        const cell: VoxelCell = {
          colorHex: state === SHELL ? shellColor(prepared, centre, voxel, voxelHeight) : '#A0A19F',
          cx: (ix - nx / 2 + 0.5) * worldSize,
          cy: (iy + 0.5) * worldLayerHeight,
          cz: (iz - nz / 2 + 0.5) * worldSize,
          i: ix,
          j: iy,
          k: iz,
          zone: 'body',
        };
        cells.push(cell);
        (state === SHELL ? surfaceCells : interiorCells).push(cell);
      }
    }
    onProgress?.(0.6 + ((ix + 1) / nx) * 0.4);
    await nextTick();
  }

  for (const prep of prepared) {
    (prep.mesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
  }
  const occupied = new Set(cells.map((cell) => `${cell.i},${cell.j},${cell.k}`));
  const visibleSurfaceCells: VoxelCell[] = [];
  const buriedSurfaceCells: VoxelCell[] = [];
  for (const cell of surfaceCells) {
    const isVisible = NEIGHBOURS.some(
      ([di, dj, dk]) => !occupied.has(`${cell.i + di},${cell.j + dj},${cell.k + dk}`),
    );
    (isVisible ? visibleSurfaceCells : buriedSurfaceCells).push(cell);
  }
  colorizeMeshCells(
    visibleSurfaceCells,
    [...interiorCells, ...buriedSurfaceCells],
    options.colorStyle ?? 'natural',
  );
  // Preserve the approved occupancy exactly. Automatic slope detection turns
  // a filled surface voxel into a half wedge, visibly eroding faces and cars.
  return buildModelFromCells(cells, worldSize, {
    layerHeight: worldLayerHeight,
    slopes: false,
  });
}

/** Voxelize an already-loaded GLB ArrayBuffer at all three profiles. */
export async function voxelizeGlb(
  buffer: ArrayBuffer,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const prepared = prepare(gltf.scene);
  if (!prepared.length) {
    throw new Error('no meshes in model');
  }
  // Progress bands weighted roughly by grid volume (40³ ≪ 64³ ≪ 88³).
  return {
    efficient: await voxelizeMeshes(prepared, 'efficient', (f) => onProgress?.(f * 0.08), options),
    balanced: await voxelizeMeshes(prepared, 'balanced', (f) => onProgress?.(0.08 + f * 0.24), options),
    detailed: await voxelizeMeshes(prepared, 'detailed', (f) => onProgress?.(0.32 + f * 0.68), options),
  };
}

/** Voxelize a GLB at a single profile (fast — library picker uses this). */
export async function voxelizeGlbOne(
  buffer: ArrayBuffer,
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<VoxelModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const prepared = prepare(gltf.scene);
  if (!prepared.length) {
    throw new Error('no meshes in model');
  }
  return voxelizeMeshes(prepared, profile, onProgress, options);
}

export async function voxelizeGlbUrlOne(
  url: string,
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<VoxelModel> {
  const buffer = await (await fetch(url)).arrayBuffer();
  return voxelizeGlbOne(buffer, profile, onProgress, options);
}

/** Fetch a GLB URL and voxelize it. */
export async function voxelizeGlbUrl(
  url: string,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return voxelizeGlb(buffer, onProgress, options);
}

export const isMeshVoxelizeSupported = true;
