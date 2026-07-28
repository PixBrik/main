/**
 * Product-grade brick rendering from REAL part geometry (web only).
 *
 * Earlier previews drew one rounded cube per voxel. That is not what the
 * customer receives: the packer merges cells into real catalogue pieces, and
 * a 2x4 brick is one moulded object with eight studs and fillets — not eight
 * cubes. This renderer takes the frozen BOM placements and draws the actual
 * GoBricks/LDraw part for each one, in the buyer's catalogue colour, under
 * studio light.
 *
 * LDraw conventions: 1 stud = 20 LDU across, 1 brick = 24 LDU tall, and +Y
 * points DOWN. Part origins are not consistent (bricks sit at their top face,
 * slopes are offset in Z), so each part is aligned by its own bounding box:
 * footprint centre to the placement centre, lowest face to the layer floor.
 * The finished model is rotated 180° about X so the scene is Y-up.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { parseLDrawMpd } from './ldrawParse';

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
  /** Descent direction for slopes — index into the engine's face directions. */
  facing?: number;
  /** Catalogue shape ('brick' | 'slope' | …) — slopes orient by facing. */
  shape?: string;
}

export interface LDrawRenderOptions {
  /** Base URL serving `<part>.mpd` files. */
  ldrawBase: string;
  /** Catalogue colour id → hex, e.g. { 10: '#FF0000' }. */
  colorHexById: Record<string, string>;
  fallbackHex?: string;
  frames?: number;
  width?: number;
  height?: number;
  /** Render on a light sweep instead of the dark studio backdrop. */
  light?: boolean;
  /** Camera elevation in radians above the horizon. */
  elevation?: number;
  /** Starting yaw in radians, so a hero angle can be chosen per subject. */
  yaw?: number;
  /**
   * Render every piece in one colour. Photogrammetry scans bake lighting into
   * their textures, and quantising that into catalogue colours turns shading
   * into speckle. Professional brick sculpture answers this the same way:
   * a single colour, with form carried entirely by geometry and real light.
   */
  monochrome?: string;
  /** Wheel assemblies (axle + wheel + tire) mounted outside the stud grid. */
  accessories?: ReadonlyArray<{
    i: number;
    j: number;
    k: number;
    side: 1 | -1;
    wheelPart: string;
    tirePart: string;
  }>;
}

interface PreparedPart {
  geometry: THREE.BufferGeometry;
  /** Offset applied so the part's footprint centres on its placement. */
  centreX: number;
  centreZ: number;
  /** LDraw Y of the part's lowest face (largest Y, since +Y is down). */
  bottomY: number;
  /** Native footprint in studs, used to decide if a piece needs a quarter turn. */
  nativeSpanX: number;
  nativeSpanZ: number;
}

const partCache = new Map<string, PreparedPart | null>();

async function loadPart(part: string, base: string): Promise<PreparedPart | null> {
  const cached = partCache.get(part);
  if (cached !== undefined) return cached;
  let prepared: PreparedPart | null = null;
  try {
    const response = await fetch(`${base}/${part}.mpd`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { positions, triangleCount } = parseLDrawMpd(await response.text());
    if (triangleCount > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // Flat per-face normals: bricks are hard-edged, and smoothing across
      // a stud fillet reads as melted plastic.
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      prepared = {
        bottomY: box.max.y,
        centreX: (box.min.x + box.max.x) / 2,
        centreZ: (box.min.z + box.max.z) / 2,
        geometry,
        nativeSpanX: Math.max(1, Math.round((box.max.x - box.min.x) / LDU_PER_STUD)),
        nativeSpanZ: Math.max(1, Math.round((box.max.z - box.min.z) / LDU_PER_STUD)),
      };
    }
  } catch {
    prepared = null;
  }
  partCache.set(part, prepared);
  return prepared;
}

/**
 * Yaw that points a slope's descent at FACE_DIRECTIONS[facing].
 *
 * Measured, not assumed: summing tilted-face normals over every slope MPD in
 * the catalogue shows they all descend toward native −z. Rotating (0,0,−1) by
 * yaw θ gives (−sin θ, 0, −cos θ), so facing 1 (+z) needs π, facing 2 (−z)
 * needs 0, facing 3 (+x) needs −π/2 and facing 4 (−x) needs π/2.
 */
function slopeRotation(facing: number | undefined): number {
  switch (facing) {
    case 1: return Math.PI;
    case 2: return 0;
    case 3: return -Math.PI / 2;
    case 4: return Math.PI / 2;
    default: return 0;
  }
}

/**
 * Parts whose native LDraw orientation differs from the 3040 family's
 * descend-toward-−z convention. Calibrated visually against a facing-1 part
 * gallery — an inverted slope's cut is an underside feature, and its mould
 * faces the opposite way.
 */
const NATIVE_YAW_OFFSET: Record<string, number> = {
  '3660': Math.PI,
  '3665': Math.PI,
};

/** Render turntable frames of a real brick build. Returns PNG data URLs. */
export async function renderLDrawTurntable(
  placements: readonly BrickPlacementLike[],
  options: LDrawRenderOptions,
): Promise<string[]> {
  if (typeof document === 'undefined' || !placements.length) return [];
  const {
    colorHexById,
    elevation = Math.PI / 8.5,
    fallbackHex = '#9BA19D',
    frames = 4,
    height = 768,
    ldrawBase,
    light = false,
    monochrome,
    width = 1024,
    yaw = -Math.PI / 5,
  } = options;

  const byPart = new Map<string, BrickPlacementLike[]>();
  for (const placement of placements) {
    const list = byPart.get(placement.part) ?? [];
    list.push(placement);
    byPart.set(placement.part, list);
  }
  const parts = new Map<string, PreparedPart | null>();
  for (const part of byPart.keys()) parts.set(part, await loadPart(part, ldrawBase));

  // Any part that fails to load still has to occupy its space, or the model
  // reads as full of holes; fall back to a plain brick-sized box.
  const fallbackGeometry = new THREE.BoxGeometry(LDU_PER_STUD, LDU_PER_BRICK, LDU_PER_STUD);
  const fallbackPart: PreparedPart = {
    bottomY: LDU_PER_BRICK / 2,
    centreX: 0,
    centreZ: 0,
    geometry: fallbackGeometry,
    nativeSpanX: 1,
    nativeSpanZ: 1,
  };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
  try {
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure follows the build's own brightness. A white or ivory sculpture
    // under the same light as a dark one clips to a featureless silhouette;
    // pulling exposure down keeps every stud edge and step readable.
    let lumaSum = 0;
    const probe = new THREE.Color();
    for (const placement of placements) {
      probe.set(monochrome ?? colorHexById[String(placement.colorId)] ?? fallbackHex);
      lumaSum += 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b;
    }
    const averageLuma = lumaSum / placements.length;
    // Pale builds (ivory sculpture, white cat) clipped to featureless white at
    // the old 0.62 floor; very bright subjects need a genuinely dim key.
    renderer.toneMappingExposure = light ? 1.05 : THREE.MathUtils.clamp(1.18 - averageLuma * 0.85, 0.42, 1.12);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(light ? '#EFEADD' : '#17130A');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const build = new THREE.Group(); // LDraw space (Y down)
    const colour = new THREE.Color();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const axis = new THREE.Vector3(0, 1, 0);
    const materials: THREE.Material[] = [];

    for (const [part, list] of byPart) {
      const prepared = parts.get(part) ?? fallbackPart;
      const material = new THREE.MeshStandardMaterial({
        envMapIntensity: light ? 1.1 : 0.95,
        metalness: 0,
        roughness: 0.34,
        // LDraw winding is not reliably consistent; double-siding with
        // three's automatic back-face normal flip avoids black patches.
        side: THREE.DoubleSide,
      });
      materials.push(material);
      const mesh = new THREE.InstancedMesh(prepared!.geometry, material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (const [index, placement] of list.entries()) {
        const spanI = placement.spanI ?? 1;
        const spanK = placement.spanK ?? 1;
        // A catalogue part has a fixed native footprint (LDraw's 2x4 brick is
        // 4 studs along X, 2 along Z). The packer places pieces in either
        // orientation, so a piece whose footprint is transposed relative to
        // its geometry needs a quarter turn — without this, long bricks are
        // laid across the model and it renders as overlapping, gappy slabs.
        // Slopes carry an explicit descent direction instead: their facing
        // fully determines the yaw, including the 180° cases a footprint
        // match cannot distinguish (a slope rendered backwards buries its
        // wedge inside the model and presents a sheer wall outward).
        const needsQuarterTurn =
          prepared!.nativeSpanX !== spanI
          && prepared!.nativeSpanX === spanK
          && prepared!.nativeSpanZ === spanI;
        const rotation = placement.shape === 'slope' || placement.facing !== undefined
          ? slopeRotation(placement.facing) + (NATIVE_YAW_OFFSET[placement.part] ?? 0)
          : needsQuarterTurn
            ? Math.PI / 2
            : 0;
        // Footprint centre of this placement, in LDU.
        const targetX = (placement.i + spanI / 2) * LDU_PER_STUD;
        const targetZ = (placement.k + spanK / 2) * LDU_PER_STUD;
        // Rotating about Y moves the part's own centre offset with it.
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const offsetX = prepared!.centreX * cos + prepared!.centreZ * sin;
        const offsetZ = -prepared!.centreX * sin + prepared!.centreZ * cos;
        position.set(
          targetX - offsetX,
          // Layer j's floor sits at -j*24; the part's lowest face must land there.
          -placement.j * LDU_PER_BRICK - prepared!.bottomY,
          targetZ - offsetZ,
        );
        quaternion.setFromAxisAngle(axis, rotation);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        colour.set(monochrome ?? colorHexById[String(placement.colorId)] ?? fallbackHex);
        // Moulded ABS never reads perfectly flat: a sub-percent value jitter
        // per piece keeps large single-colour areas from looking painted.
        const jitter = 1 + (((placement.i * 73856093) ^ (placement.j * 19349663) ^ (placement.k * 83492791)) % 7 - 3) * 0.005;
        colour.multiplyScalar(jitter);
        mesh.setColorAt(index, colour);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      build.add(mesh);
    }

    // Real wheels: the wheel's and tire's native axis is LDraw z; a quarter
    // turn about Y points it along ±x (out the car's side). The centre sits
    // half a tire-width beyond the anchor cell's outer face, at the middle of
    // the anchor layer.
    if (options.accessories?.length) {
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#9BA19D', metalness: 0.1, roughness: 0.35 });
      const tireMaterial = new THREE.MeshStandardMaterial({ color: '#1B1D1E', metalness: 0, roughness: 0.85 });
      materials.push(wheelMaterial, tireMaterial);
      for (const accessory of options.accessories) {
        const wheelPrepared = await loadPart(accessory.wheelPart, ldrawBase);
        const tirePrepared = await loadPart(accessory.tirePart, ldrawBase);
        // The anchor is the carve's outermost column: mount the assembly with
        // its outer sidewall flush to that face, like the source's wheels.
        // Tire width comes from the part's own geometry (native axis = z).
        let tireHalf = 18;
        if (tirePrepared) {
          tirePrepared.geometry.computeBoundingBox();
          const box = tirePrepared.geometry.boundingBox!;
          tireHalf = (box.max.z - box.min.z) / 2;
        }
        const outerFace = (accessory.i + (accessory.side > 0 ? 1 : 0)) * LDU_PER_STUD;
        const centreX = outerFace - accessory.side * tireHalf;
        const centreY = -(accessory.j + 0.5) * LDU_PER_BRICK;
        const centreZ = (accessory.k + 0.5) * LDU_PER_STUD;
        for (const [prepared, material] of [
          [wheelPrepared, wheelMaterial],
          [tirePrepared, tireMaterial],
        ] as const) {
          if (!prepared) continue;
          const mesh = new THREE.Mesh(prepared.geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Place the part's bbox centre exactly at the wheel centre: with a
          // quarter turn about Y, a part-space point p lands at position +
          // (p.z, p.y, −p.x), so subtract the rotated bbox centre.
          prepared.geometry.computeBoundingBox();
          const partCentre = prepared.geometry.boundingBox!.getCenter(new THREE.Vector3());
          mesh.rotation.y = Math.PI / 2;
          mesh.position.set(
            centreX - partCentre.z,
            centreY - partCentre.y,
            centreZ + partCentre.x,
          );
          build.add(mesh);
        }
      }
    }

    // Centre on the origin, sit on the floor, and flip LDraw's Y-down to Y-up.
    const bounds = new THREE.Box3().setFromObject(build);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    build.position.set(-centre.x, -bounds.max.y, -centre.z);
    const flip = new THREE.Group();
    flip.rotation.x = Math.PI;
    flip.add(build);
    const turntable = new THREE.Group();
    turntable.add(flip);
    scene.add(turntable);

    const spanY = size.y;
    const radius = Math.max(size.x, size.z) / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(radius, spanY) * 24, Math.max(radius, spanY) * 24),
      new THREE.ShadowMaterial({ opacity: light ? 0.26 : 0.46 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Raking key light: a low, angled key throws each brick's shadow onto the
    // course below, which is what makes stacked plastic read as stacked
    // plastic rather than a smooth painted mass.
    const key = new THREE.DirectionalLight('#fff6e8', light ? 2.2 : 2.9);
    key.position.set(radius * 3.0, spanY * 1.5 + radius * 1.1, radius * 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowSpan = Math.max(radius * 2.6, spanY * 1.8);
    key.shadow.camera.left = -shadowSpan;
    key.shadow.camera.right = shadowSpan;
    key.shadow.camera.top = shadowSpan;
    key.shadow.camera.bottom = -shadowSpan;
    key.shadow.camera.far = radius * 24 + spanY * 12;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 1.5;
    scene.add(key);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.55);
    fill.position.set(-radius * 2.6, spanY * 1.2, -radius * 1.2);
    scene.add(fill);
    // Rim from behind separates the silhouette from the backdrop.
    const rim = new THREE.DirectionalLight('#ffffff', light ? 0.4 : 1.05);
    rim.position.set(-radius * 1.4, spanY * 2.2, -radius * 3.0);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(28, width / height, 1, radius * 90 + spanY * 45);
    const sphere = 0.5 * Math.hypot(size.x, size.y, size.z);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = (sphere / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;
    const lookY = spanY * 0.5;

    const out: string[] = [];
    for (let frame = 0; frame < frames; frame++) {
      turntable.rotation.y = yaw + (frame * Math.PI * 2) / frames;
      camera.position.set(
        distance * Math.cos(elevation) * 0.34,
        lookY + distance * Math.sin(elevation),
        distance * Math.cos(elevation),
      );
      camera.lookAt(0, lookY, 0);
      renderer.render(scene, camera);
      out.push(canvas.toDataURL('image/png'));
    }

    for (const material of materials) material.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    fallbackGeometry.dispose();
    pmrem.dispose();
    return out;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
