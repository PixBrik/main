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
  /** Optional subject-specific stud spans; human likenesses need a denser grid. */
  studSpans?: Partial<Record<MeshProfile, number>>;
  /**
   * `skin` (default) raycasts from outside toward each exposed voxel face and
   * keeps the first surface hit: exactly what a viewer sees, robust to the
   * flipped normals common in AI meshes. `nearest` samples the closest
   * surface — which can be a HIDDEN interior wall (a car's seats through the
   * glass, a pot's inside) — and remains only as an A/B reference.
   */
  colourSampling?: 'nearest' | 'skin';
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

interface SubjectPart {
  bounds: THREE.Box3;
  diagonal: number;
  isBroadPlane: boolean;
  surfaceArea: number;
  triangleCount: number;
}

interface MeshCandidate extends SubjectPart {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

interface TriangleComponent extends SubjectPart {
  triangles: number[];
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

const FULLY_TRANSPARENT_OPACITY = 1e-3;
const BROAD_PLANE_THICKNESS_RATIO = 0.012;
const BROAD_PLANE_SECOND_AXIS_RATIO = 0.35;
const OVERSIZED_PLANE_SCALE = 1.5;
const TINY_DEBRIS_DIAGONAL_RATIO = 0.025;
const TINY_DEBRIS_AREA_RATIO = 0.002;
const TINY_DEBRIS_DISTANCE_RATIO = 0.15;

function isEffectivelyVisible(node: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = node; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function materialRenders(material: THREE.Material | undefined): boolean {
  if (!material || !material.visible || material.colorWrite === false) return false;
  const alphaCanHideSurface = material.transparent || material.alphaTest > FULLY_TRANSPARENT_OPACITY;
  return !(alphaCanHideSurface && material.opacity <= FULLY_TRANSPARENT_OPACITY);
}

function materialIndexAt(geometry: THREE.BufferGeometry, elementOffset: number): number {
  const group = geometry.groups.find(
    (candidate) => elementOffset >= candidate.start && elementOffset < candidate.start + candidate.count,
  );
  return group?.materialIndex ?? 0;
}

function subjectPart(
  bounds: THREE.Box3,
  surfaceArea: number,
  triangleCount: number,
): SubjectPart {
  const size = bounds.getSize(new THREE.Vector3());
  const dimensions = [size.x, size.y, size.z].sort((left, right) => left - right);
  const largest = dimensions[2] || 0;
  return {
    bounds,
    diagonal: size.length(),
    isBroadPlane: largest > 0
      && dimensions[0]! / largest <= BROAD_PLANE_THICKNESS_RATIO
      && dimensions[1]! / largest >= BROAD_PLANE_SECOND_AXIS_RATIO,
    surfaceArea,
    triangleCount,
  };
}

/** Partition one geometry into topologically connected triangle islands. */
function triangleComponents(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  triangleIndices: number[],
  triangleAreas: number[],
  overallBounds: THREE.Box3,
): TriangleComponent[] {
  const triangleCount = triangleAreas.length;
  if (triangleCount <= 1) {
    return [{
      ...subjectPart(overallBounds.clone(), triangleAreas[0] ?? 0, triangleCount),
      triangles: triangleCount ? [0] : [],
    }];
  }

  const parent = new Int32Array(triangleCount);
  const rank = new Uint8Array(triangleCount);
  for (let index = 0; index < triangleCount; index++) parent[index] = index;
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (rank[leftRoot]! < rank[rightRoot]!) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parent[rightRoot] = leftRoot;
    if (rank[leftRoot] === rank[rightRoot]) rank[leftRoot] = rank[leftRoot]! + 1;
  };

  // Coordinate welding connects non-indexed geometry and UV-seam duplicates.
  // The tolerance is seven orders below the model span, far too small to join
  // separate features that merely happen to sit close together.
  const weld = Math.max(overallBounds.getSize(new THREE.Vector3()).length() * 1e-7, 1e-9);
  const firstTriangleAtVertex = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangleIndices[triangle * 3 + corner]!;
      const key = `${Math.round(position.getX(vertex) / weld)}|${Math.round(position.getY(vertex) / weld)}|${Math.round(position.getZ(vertex) / weld)}`;
      const first = firstTriangleAtVertex.get(key);
      if (first === undefined) firstTriangleAtVertex.set(key, triangle);
      else union(triangle, first);
    }
  }

  const grouped = new Map<number, { bounds: THREE.Box3; surfaceArea: number; triangles: number[] }>();
  const point = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = find(triangle);
    let group = grouped.get(root);
    if (!group) {
      group = { bounds: new THREE.Box3().makeEmpty(), surfaceArea: 0, triangles: [] };
      grouped.set(root, group);
    }
    group.triangles.push(triangle);
    group.surfaceArea += triangleAreas[triangle]!;
    for (let corner = 0; corner < 3; corner++) {
      point.fromBufferAttribute(position, triangleIndices[triangle * 3 + corner]!);
      group.bounds.expandByPoint(point);
    }
  }
  return [...grouped.values()].map((group) => ({
    ...subjectPart(group.bounds, group.surfaceArea, group.triangles.length),
    triangles: group.triangles,
  }));
}

/**
 * Clone one mesh in world space and remove triangles that can never render.
 * BoundingBox.computeBoundingBox() considers unused attribute vertices, so we
 * build the bounds from the retained triangles as well: a single degenerate,
 * far-away vertex must not make the subject resolve to a handful of voxels.
 */
function collectCandidate(mesh: THREE.Mesh): MeshCandidate | null {
  if (!mesh.geometry || !isEffectivelyVisible(mesh)) return null;
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
  if (!materials.some(materialRenders)) return null;

  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld); // bake transform -> world space
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3 || position.count < 3) {
    geometry.dispose();
    return null;
  }

  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  const drawStart = Math.max(0, geometry.drawRange.start || 0);
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.max(0, geometry.drawRange.count)
    : elementCount - drawStart;
  const drawEnd = Math.min(elementCount, drawStart + drawCount);
  const retainedIndices: number[] = [];
  const retainedMaterials: number[] = [];
  const retainedAreas: number[] = [];
  const bounds = new THREE.Box3().makeEmpty();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let surfaceArea = 0;

  for (let offset = drawStart; offset + 2 < drawEnd; offset += 3) {
    const materialIndex = materialIndexAt(geometry, offset);
    if (!materialRenders(materials[materialIndex] ?? materials[0])) continue;
    const ia = index ? index.getX(offset) : offset;
    const ib = index ? index.getX(offset + 1) : offset + 1;
    const ic = index ? index.getX(offset + 2) : offset + 2;
    if (
      !Number.isInteger(ia) || !Number.isInteger(ib) || !Number.isInteger(ic)
      || ia < 0 || ib < 0 || ic < 0
      || ia >= position.count || ib >= position.count || ic >= position.count
    ) continue;

    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    if (![a, b, c].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) {
      continue;
    }
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const twiceArea = cross.crossVectors(ab, ac).length();
    const maxEdgeSquared = Math.max(ab.lengthSq(), ac.lengthSq(), b.distanceToSquared(c));
    if (!(twiceArea > maxEdgeSquared * 1e-12)) continue;

    retainedIndices.push(ia, ib, ic);
    retainedMaterials.push(materialIndex);
    retainedAreas.push(twiceArea / 2);
    bounds.expandByPoint(a);
    bounds.expandByPoint(b);
    bounds.expandByPoint(c);
    surfaceArea += twiceArea / 2;
  }

  if (!retainedMaterials.length || bounds.isEmpty() || !(surfaceArea > 0)) {
    geometry.dispose();
    return null;
  }

  // AI exporters often collapse the subject, floor and floating scan specks
  // into one mesh. Partitioning by welded triangle connectivity lets the same
  // conservative subject rules work within a mesh as well as between meshes.
  const components = triangleComponents(position, retainedIndices, retainedAreas, bounds);
  const retainedComponents = new Set(sanitizeSubjectParts(components));
  const finalIndices: number[] = [];
  const finalMaterials: number[] = [];
  bounds.makeEmpty();
  surfaceArea = 0;
  for (const component of components) {
    if (!retainedComponents.has(component)) continue;
    bounds.union(component.bounds);
    surfaceArea += component.surfaceArea;
    for (const triangle of component.triangles) {
      finalIndices.push(
        retainedIndices[triangle * 3]!,
        retainedIndices[triangle * 3 + 1]!,
        retainedIndices[triangle * 3 + 2]!,
      );
      finalMaterials.push(retainedMaterials[triangle]!);
    }
  }
  if (!finalMaterials.length || bounds.isEmpty()) {
    geometry.dispose();
    return null;
  }

  // Use an explicit index so degenerate non-indexed triangles no longer take
  // part in BVH queries. Rebuild groups to keep per-face material lookup exact.
  geometry.setIndex(finalIndices);
  geometry.clearGroups();
  let groupStart = 0;
  let groupMaterial = finalMaterials[0]!;
  for (let triangle = 1; triangle <= finalMaterials.length; triangle++) {
    const nextMaterial = finalMaterials[triangle];
    if (triangle === finalMaterials.length || nextMaterial !== groupMaterial) {
      geometry.addGroup(groupStart, triangle * 3 - groupStart, groupMaterial);
      groupStart = triangle * 3;
      groupMaterial = nextMaterial ?? groupMaterial;
    }
  }
  geometry.boundingBox = bounds.clone();

  const stats = subjectPart(bounds, surfaceArea, finalMaterials.length);
  return {
    ...stats,
    geometry,
    materials,
  };
}

function boxDistance(left: THREE.Box3, right: THREE.Box3): number {
  const dx = Math.max(0, left.min.x - right.max.x, right.min.x - left.max.x);
  const dy = Math.max(0, left.min.y - right.max.y, right.min.y - left.max.y);
  const dz = Math.max(0, left.min.z - right.max.z, right.min.z - left.max.z);
  return Math.hypot(dx, dy, dz);
}

function subjectScore(candidate: SubjectPart): number {
  // Triangle count only breaks close calls; scale remains the primary signal
  // so a detailed eye or wheel cannot outrank the body that contains it.
  return candidate.diagonal * (1 + Math.min(0.35, Math.log2(candidate.triangleCount + 1) * 0.035));
}

/**
 * Keep the largest volumetric subject and every plausible nearby part. Only
 * two relative, high-confidence contaminant classes are removed:
 *   - a broad, paper-thin plane at least 1.5x the subject (floor/backdrop);
 *   - a minute component far from every substantial subject part (scene dust).
 * Small overlapping/nearby meshes are deliberately retained for eyes, hair,
 * wheels, jewellery and other multipart details.
 */
const PEDESTAL_FOOTPRINT_RATIO = 1.5;

function partFootprint(part: SubjectPart): number {
  return Math.max(1e-9, (part.bounds.max.x - part.bounds.min.x) * (part.bounds.max.z - part.bounds.min.z));
}

/**
 * A pedestal is what the subject STANDS ON: a wider part whose top the
 * detailed part rests against, with the subject's footprint inside its own.
 * Product masters ship on cloths, trays and display bases constantly — left
 * in, the base owns the stud budget (the toy car spent two thirds of its
 * bricks on a black fabric mound) and often outranks the subject on raw size.
 */
function findPedestals<T extends SubjectPart>(candidates: T[]): Set<T> {
  const pedestals = new Set<T>();
  let sceneMinY = Infinity;
  let sceneMaxY = -Infinity;
  for (const candidate of candidates) {
    sceneMinY = Math.min(sceneMinY, candidate.bounds.min.y);
    sceneMaxY = Math.max(sceneMaxY, candidate.bounds.max.y);
  }
  const epsilon = Math.max(1e-9, (sceneMaxY - sceneMinY) * 0.06);
  for (const ground of candidates) {
    for (const subject of candidates) {
      if (subject === ground) continue;
      const rests = Math.abs(subject.bounds.min.y - ground.bounds.max.y) <= epsilon;
      const contained = subject.bounds.min.x >= ground.bounds.min.x - epsilon
        && subject.bounds.max.x <= ground.bounds.max.x + epsilon
        && subject.bounds.min.z >= ground.bounds.min.z - epsilon
        && subject.bounds.max.z <= ground.bounds.max.z + epsilon;
      if (
        rests
        && contained
        && partFootprint(ground) >= partFootprint(subject) * PEDESTAL_FOOTPRINT_RATIO
        && subject.triangleCount >= ground.triangleCount * 0.8
      ) {
        pedestals.add(ground);
        break;
      }
    }
  }
  return pedestals;
}

function sanitizeSubjectParts<T extends SubjectPart>(candidates: T[], stripGround = true): T[] {
  if (candidates.length <= 1) return candidates;
  const pedestals = stripGround ? findPedestals(candidates) : new Set<T>();
  const standing = candidates.filter((candidate) => !pedestals.has(candidate));
  const pool = standing.length ? standing : candidates;
  const volumetric = pool.filter((candidate) => !candidate.isBroadPlane);
  if (!volumetric.length) return pool;
  const primary = volumetric.reduce((best, candidate) => (
    subjectScore(candidate) > subjectScore(best) ? candidate : best
  ));
  // Second net for grounds nothing rests on exactly: bottom-anchored low
  // parts whose footprint dwarfs the chosen subject.
  const primaryHeight = Math.max(1e-9, primary.bounds.max.y - primary.bounds.min.y);
  const grounds = stripGround
    ? new Set(pool.filter((candidate) => (
      candidate !== primary
      && partFootprint(candidate) >= partFootprint(primary) * 2
      && candidate.bounds.min.y <= primary.bounds.min.y + primaryHeight * 0.15
      && candidate.bounds.max.y <= primary.bounds.min.y + primaryHeight * 0.5
    )))
    : new Set<T>();
  const withoutPlanes = pool.filter((candidate) => (
    candidate === primary
    || (!grounds.has(candidate)
    && (!candidate.isBroadPlane
    || candidate.diagonal < primary.diagonal * OVERSIZED_PLANE_SCALE))
  ));

  const core = withoutPlanes.filter((candidate) => (
    candidate === primary
    || candidate.diagonal >= primary.diagonal * 0.08
    || candidate.surfaceArea >= primary.surfaceArea * 0.01
  ));
  const coreSet = new Set(core);
  return withoutPlanes.filter((candidate) => {
    if (candidate === primary || coreSet.has(candidate)) return true;
    const isTiny = candidate.diagonal <= primary.diagonal * TINY_DEBRIS_DIAGONAL_RATIO
      && candidate.surfaceArea <= primary.surfaceArea * TINY_DEBRIS_AREA_RATIO;
    if (!isTiny) return true;
    let nearestCore = Infinity;
    for (const part of core) {
      nearestCore = Math.min(nearestCore, boxDistance(candidate.bounds, part.bounds));
    }
    return nearestCore <= primary.diagonal * TINY_DEBRIS_DISTANCE_RATIO;
  });
}

function prepare(root: THREE.Object3D): PreparedMesh[] {
  root.updateWorldMatrix(true, true);
  const candidates: MeshCandidate[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const candidate = collectCandidate(mesh);
    if (candidate) candidates.push(candidate);
  });
  const retained = new Set(sanitizeSubjectParts(candidates));
  for (const candidate of candidates) {
    if (!retained.has(candidate)) candidate.geometry.dispose();
  }

  return candidates.filter((candidate) => retained.has(candidate)).map((candidate) => {
    // Raycast through a double-sided copy: parity counts EVERY wall crossing,
    // and a FrontSide source material would silently cull the exits.
    const raycastMaterials = candidate.materials.map((material) => {
      const copy = material.clone();
      copy.side = THREE.DoubleSide;
      return copy;
    });
    const worldMesh = new THREE.Mesh(
      candidate.geometry,
      raycastMaterials.length === 1 ? raycastMaterials[0]! : raycastMaterials,
    );
    const bvh = new MeshBVH(candidate.geometry);
    (candidate.geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
    return {
      bvh,
      bounds: candidate.bounds.clone(),
      hasVertexColor: !!candidate.geometry.getAttribute('color'),
      materials: candidate.materials.map((material) => ({
        materialColor: (material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color('#cccccc'),
        textureData: materialRenders(material) ? readTexture(material) : null,
      })),
      mesh: worldMesh,
    };
  });
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
  return colorAtFacePoint(prep, (hit as { faceIndex?: number } | null)?.faceIndex ?? 0, hit ? tempTarget.point : null);
}

/** Barycentric surface colour of one triangle at an exact surface point. */
function colorAtFacePoint(prep: PreparedMesh, faceIndex: number, surfacePoint: THREE.Vector3 | null): string {
  const geometry = prep.mesh.geometry;
  const material = materialForFace(prep, faceIndex);
  const index = geometry.getIndex();
  const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;

  // Barycentric weights of the surface point inside its triangle; centroid
  // weights as the degenerate-triangle fallback.
  let wa = 1 / 3, wb = 1 / 3, wc = 1 / 3;
  if (surfacePoint) {
    const position = geometry.getAttribute('position');
    triA.fromBufferAttribute(position, a);
    triB.fromBufferAttribute(position, b);
    triC.fromBufferAttribute(position, c);
    const bary = THREE.Triangle.getBarycoord(surfacePoint, triA, triB, triC, baryCoord);
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
  return pickMedoid(hexes);
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Redmean-medoid of a sample set: a colour that genuinely exists in it. */
function pickMedoid(hexes: string[]): string {
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

const skinRaycaster = new THREE.Raycaster();
const skinOrigin = new THREE.Vector3();
const skinDir = new THREE.Vector3();
/** In-face jitter (fractions of a voxel) applied perpendicular to each ray. */
const SKIN_JITTER: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.3, 0.2], [-0.25, -0.3], [0.2, -0.25],
];

/**
 * Visible-skin colour: for every EXPOSED face of the voxel, cast jittered
 * rays from well outside toward the voxel centre and sample the FIRST surface
 * each ray meets — by construction the skin a viewer (and builder) sees.
 * Nearest-surface sampling instead bleeds hidden interiors onto the shell:
 * a car's dark cabin recoloured its window pillars, a pot's inside its rim.
 */
function skinColor(
  prepared: PreparedMesh[],
  meshByObject: Map<THREE.Object3D, PreparedMesh>,
  centre: THREE.Vector3,
  voxel: number,
  voxelHeight: number,
  exposedDirs: ReadonlyArray<readonly [number, number, number]>,
): string | null {
  const hexes: string[] = [];
  const meshes = prepared.map((prep) => prep.mesh);
  for (const [dx, dy, dz] of exposedDirs) {
    // Perpendicular jitter axes for this direction.
    const px = dy !== 0 || dz !== 0 ? 1 : 0;
    const pz = dx !== 0 || dy !== 0 ? 1 : 0;
    for (const [j1, j2] of SKIN_JITTER) {
      skinOrigin.set(
        centre.x + dx * voxel * 3 + px * j1 * voxel,
        centre.y + dy * voxelHeight * 3 + (px && pz ? 0 : j2 * voxelHeight),
        centre.z + dz * voxel * 3 + pz * (px ? j2 : j1) * voxel,
      );
      skinDir.set(centre.x - skinOrigin.x, centre.y - skinOrigin.y, centre.z - skinOrigin.z).normalize();
      skinRaycaster.set(skinOrigin, skinDir);
      skinRaycaster.near = 0;
      skinRaycaster.far = voxel * 7;
      const hits = skinRaycaster.intersectObjects(meshes, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) continue;
      const prep = meshByObject.get(hit.object);
      if (!prep) continue;
      hexes.push(colorAtFacePoint(prep, hit.faceIndex, hit.point));
    }
  }
  return hexes.length ? pickMedoid(hexes) : null;
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
  const targetSpan = Math.max(1, Math.round(options.studSpans?.[profile] ?? RES[profile]));
  const voxel = maxAxis / targetSpan;
  const voxelHeight = voxel * BRICK_HEIGHT_RATIO;
  const worldSize = 6.3 / targetSpan; // match built-in models' scale
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
  const useSkin = options.colourSampling !== 'nearest';
  const meshByObject = new Map<THREE.Object3D, PreparedMesh>(prepared.map((prep) => [prep.mesh, prep]));
  const exposedDirs: Array<readonly [number, number, number]> = [];
  const isOutside = (ix: number, iy: number, iz: number) =>
    ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz || grid[at(ix, iy, iz)] === OUTSIDE;
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
        let shellHex: string | null = null;
        if (state === SHELL && useSkin) {
          exposedDirs.length = 0;
          for (const dir of NEIGHBOURS) {
            if (isOutside(ix + dir[0], iy + dir[1], iz + dir[2])) exposedDirs.push(dir);
          }
          if (exposedDirs.length) {
            shellHex = skinColor(prepared, meshByObject, centre, voxel, voxelHeight, exposedDirs);
          }
        }
        const cell: VoxelCell = {
          colorHex: state === SHELL ? shellHex ?? shellColor(prepared, centre, voxel, voxelHeight) : '#A0A19F',
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
  const anchored = await anchorAgainstReleaseGate(cells, worldSize, worldLayerHeight);
  // Preserve the approved occupancy exactly. Automatic slope detection turns
  // a filled surface voxel into a half wedge, visibly eroding faces and cars.
  return buildModelFromCells(anchored, worldSize, {
    layerHeight: worldLayerHeight,
    slopes: false,
  });
}

/**
 * Anchor repair against the REAL release gate. Voxel-level support
 * heuristics kept diverging from the packer (piece splits, colour runs), so
 * the exact pipeline is the referee: pack the solid kit, plan its assembly,
 * and for every genuinely unsupported piece grow a short support column from
 * its own footprint down (or up) to existing structure — it reads as a
 * deliberate brick detail. Unrescuable micro-pieces are dropped. Guarantees
 * the SOLID fill of every generated kit passes the gate; reinforced-hollow
 * stays honestly gated per model.
 */
async function anchorAgainstReleaseGate(
  cells: VoxelCell[],
  worldSize: number,
  worldLayerHeight: number,
): Promise<VoxelCell[]> {
  const { brickify } = await import('../brickify');
  const { createAssemblyPlan } = await import('../instructions/assemblyPlan');
  let all = cells;
  const MAX_GAP = 12;
  for (let round = 0; round < 5; round++) {
    const byKey = new Map(all.map((cell) => [`${cell.i},${cell.j},${cell.k}`, cell]));
    const model = buildModelFromCells(all, worldSize, { layerHeight: worldLayerHeight, slopes: false });
    const plan = createAssemblyPlan(brickify(model, '#FF3D17'));
    await nextTick();
    const offenders = plan.steps
      .filter((step) => step.support.status === 'unsupported')
      .map((step) => step.placement as { i: number; j: number; k: number; spanI?: number; spanK?: number });
    if (!offenders.length) return all;

    const additions: VoxelCell[] = [];
    const drop = new Set<VoxelCell>();
    for (const piece of offenders) {
      const spanI = piece.spanI ?? 1;
      const spanK = piece.spanK ?? 1;
      let fixed = false;
      for (const direction of [-1, 1] as const) {
        for (let di = 0; di < spanI && !fixed; di++) {
          for (let dk = 0; dk < spanK && !fixed; dk++) {
            const ci = piece.i + di;
            const ck = piece.k + dk;
            for (let gap = 2; gap <= MAX_GAP; gap++) {
              const target = byKey.get(`${ci},${piece.j + direction * gap},${ck}`);
              if (!target) continue;
              const base = byKey.get(`${ci},${piece.j},${ck}`) ?? target;
              for (let step = 1; step < gap; step++) {
                const fillJ = piece.j + direction * step;
                const key = `${ci},${fillJ},${ck}`;
                if (byKey.has(key)) continue;
                const post: VoxelCell = {
                  ...base,
                  colorHex: target.colorHex ?? base.colorHex,
                  cy: (fillJ + 0.5) * worldLayerHeight,
                  j: fillJ,
                };
                byKey.set(key, post);
                additions.push(post);
              }
              fixed = true;
              break;
            }
          }
        }
        if (fixed) break;
      }
      if (!fixed) {
        const pieceCells: VoxelCell[] = [];
        for (let di = 0; di < spanI; di++) {
          for (let dk = 0; dk < spanK; dk++) {
            const cell = byKey.get(`${piece.i + di},${piece.j},${piece.k + dk}`);
            if (cell) pieceCells.push(cell);
          }
        }
        if (pieceCells.length <= 6) for (const cell of pieceCells) drop.add(cell);
      }
    }
    if (!additions.length && !drop.size) return all;
    all = [...all.filter((cell) => !drop.has(cell)), ...additions];
  }
  return all;
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
  const buffer = await fetchGlb(url);
  return voxelizeGlbOne(buffer, profile, onProgress, options);
}

const MAX_CLIENT_GLB_BYTES = 128 * 1024 * 1024;

async function fetchGlb(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`generated model download failed (${response.status})`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CLIENT_GLB_BYTES) {
    throw new Error('generated model is too large to convert safely in this browser');
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 12 || buffer.byteLength > MAX_CLIENT_GLB_BYTES) {
    throw new Error('generated model is not a supported GLB file');
  }
  const signature = new Uint8Array(buffer, 0, 4);
  if (signature[0] !== 0x67 || signature[1] !== 0x6c || signature[2] !== 0x54 || signature[3] !== 0x46) {
    throw new Error('generated model is not a supported GLB file');
  }
  return buffer;
}

/** Fetch a GLB URL and voxelize it. */
export async function voxelizeGlbUrl(
  url: string,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  const buffer = await fetchGlb(url);
  return voxelizeGlb(buffer, onProgress, options);
}

/**
 * One placed instance in a composed build (bouquets: N flowers + a vase).
 * Every source mesh is first normalized to a 1-unit longest axis, so scale,
 * position and lift are all expressed in that shared normalized frame —
 * composing a 30 cm scan with a 3 m scan Just Works.
 */
export interface ComposedPart {
  url: string;
  /** Uniform scale in the normalized frame (1 = same longest axis). */
  scale?: number;
  /** XZ placement in normalized units (Y up comes from `lift`). */
  x?: number;
  z?: number;
  /** Raise the instance's base above the ground plane (normalized units). */
  lift?: number;
  /** Which way the instance leans (degrees around Y). */
  leanDirectionDeg?: number;
  /** How far it leans from vertical (degrees). */
  leanDeg?: number;
  /** Spin the instance around its own vertical axis (degrees). */
  spinDeg?: number;
}

async function prepareComposedParts(parts: ComposedPart[]): Promise<PreparedMesh[]> {
  if (!parts.length) throw new Error('nothing to compose');
  const buffers = new Map<string, ArrayBuffer>();
  for (const part of parts) {
    if (!buffers.has(part.url)) buffers.set(part.url, await fetchGlb(part.url));
  }
  const loader = new GLTFLoader();
  const prepared: PreparedMesh[] = [];
  for (const part of parts) {
    // Parse per instance: each placement needs its own scene graph.
    const gltf = await loader.parseAsync(buffers.get(part.url)!.slice(0), '');
    const scene = gltf.scene;

    // Normalize: longest axis → 1 unit, base resting on y=0.
    const bounds = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const normalize = (1 / maxAxis) * (part.scale ?? 1);
    const inner = new THREE.Group();
    inner.add(scene);
    scene.scale.setScalar(normalize);
    scene.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * normalize,
      -bounds.min.y * normalize,
      -((bounds.min.z + bounds.max.z) / 2) * normalize,
    );

    // Spin about its own axis, then lean, then place.
    inner.rotation.y = ((part.spinDeg ?? 0) * Math.PI) / 180;
    const leaner = new THREE.Group();
    leaner.add(inner);
    leaner.rotation.z = ((part.leanDeg ?? 0) * Math.PI) / 180;
    const placer = new THREE.Group();
    placer.add(leaner);
    placer.rotation.y = ((part.leanDirectionDeg ?? 0) * Math.PI) / 180;
    const root = new THREE.Group();
    placer.position.set(part.x ?? 0, part.lift ?? 0, part.z ?? 0);
    root.add(placer);

    // prepare() per instance so sanitization never compares across instances.
    prepared.push(...prepare(root));
  }
  if (!prepared.length) throw new Error('no meshes in composed model');
  return prepared;
}

/** Voxelize a composed multi-instance scene at all three profiles. */
export async function voxelizeComposedUrl(
  parts: ComposedPart[],
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<Record<MeshProfile, VoxelModel>> {
  const prepared = await prepareComposedParts(parts);
  return {
    efficient: await voxelizeMeshes(prepared, 'efficient', (f) => onProgress?.(f * 0.08), options),
    balanced: await voxelizeMeshes(prepared, 'balanced', (f) => onProgress?.(0.08 + f * 0.24), options),
    detailed: await voxelizeMeshes(prepared, 'detailed', (f) => onProgress?.(0.32 + f * 0.68), options),
  };
}

/** Voxelize a composed multi-instance scene at a single profile. */
export async function voxelizeComposedUrlOne(
  parts: ComposedPart[],
  profile: MeshProfile,
  onProgress?: VoxelizeProgressFn,
  options: MeshVoxelizeOptions = {},
): Promise<VoxelModel> {
  const prepared = await prepareComposedParts(parts);
  return voxelizeMeshes(prepared, profile, onProgress, options);
}

export const isMeshVoxelizeSupported = true;
