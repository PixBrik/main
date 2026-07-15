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
    const worldMesh = new THREE.Mesh(geometry, mesh.material);
    const bvh = new MeshBVH(geometry);
    (geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
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

/** Voxelize prepared meshes into a FotoBrik model. */
function voxelizeMeshes(prepared: PreparedMesh[], profile: MeshProfile): VoxelModel {
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

  const rayDir = new THREE.Vector3(1, 0, 0);
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
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
        raycaster.set(centre, rayDir);
        const hits = raycaster.intersectObjects(meshes, false);
        // Odd number of forward crossings → inside the solid.
        if (hits.length % 2 !== 1) continue;

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
  }

  for (const prep of prepared) {
    (prep.mesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
  }
  return buildModelFromCells(cells, worldSize, { slopes: true });
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
    balanced: voxelizeMeshes(prepared, 'balanced'),
    detailed: voxelizeMeshes(prepared, 'detailed'),
    efficient: voxelizeMeshes(prepared, 'efficient'),
  };
}

/** Voxelize a GLB at a single profile (fast — library picker uses this). */
export async function voxelizeGlbOne(buffer: ArrayBuffer, profile: MeshProfile): Promise<VoxelModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const prepared = prepare(gltf.scene);
  if (!prepared.length) {
    throw new Error('no meshes in model');
  }
  return voxelizeMeshes(prepared, profile);
}

export async function voxelizeGlbUrlOne(url: string, profile: MeshProfile): Promise<VoxelModel> {
  const buffer = await (await fetch(url)).arrayBuffer();
  return voxelizeGlbOne(buffer, profile);
}

/** Fetch a GLB URL and voxelize it. */
export async function voxelizeGlbUrl(url: string): Promise<Record<MeshProfile, VoxelModel>> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return voxelizeGlb(buffer);
}

export const isMeshVoxelizeSupported = true;
