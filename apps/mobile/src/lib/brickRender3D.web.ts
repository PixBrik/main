/**
 * Photoreal brick turntable rendering (web only).
 *
 * The flat SVG projection made every kit look like painted cubes. Real brick
 * product shots read as real because of four things this module reproduces:
 * bevelled brick edges with visible seams, studs, glossy ABS under soft
 * studio environment light, and a grounding contact shadow. One instanced
 * draw call renders tens of thousands of bricks; the renderer is created,
 * used and destroyed per call so preview generation never leaks a WebGL
 * context (same discipline as meshSnapshot).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { BRICK_HEIGHT_RATIO, type VoxelModel } from './voxelFox';

export const TURNTABLE_3D_WIDTH = 640;
export const TURNTABLE_3D_HEIGHT = 480;

/** Stud-brick unit geometry in cell units: 1 × height-ratio × 1. */
function brickGeometry(layerRatio: number): THREE.BufferGeometry {
  const shrink = 0.965; // visible seam between bricks
  const body = new RoundedBoxGeometry(shrink, layerRatio * shrink, shrink, 2, 0.055);
  body.translate(0, (layerRatio * shrink) / 2, 0);
  const stud = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20);
  stud.translate(0, layerRatio * shrink + 0.09, 0);
  // Normalize both primitives to bare non-indexed position+normal buffers:
  // mergeGeometries returns null on any attribute-set mismatch.
  const parts = [body, stud].map((part) => {
    const plain = part.toNonIndexed();
    for (const name of Object.keys(plain.attributes)) {
      if (name !== 'position' && name !== 'normal') plain.deleteAttribute(name);
    }
    return plain;
  });
  const merged = BufferGeometryUtils.mergeGeometries(parts);
  if (!merged) throw new Error('brick geometry merge failed');
  return merged;
}

/**
 * Render N turntable frames of a voxel model as PNG data URLs with a
 * product-photography look. Angles step evenly around the vertical axis
 * starting from a three-quarter hero view.
 */
export function renderBrickTurntable3D(
  model: VoxelModel,
  frames = 4,
  width = TURNTABLE_3D_WIDTH,
  height = TURNTABLE_3D_HEIGHT,
): string[] {
  if (typeof document === 'undefined') return [];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
  try {
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#17130A');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const layerRatio = (model.layerHeight ?? model.size * BRICK_HEIGHT_RATIO) / model.size;
    const geometry = brickGeometry(layerRatio);
    const material = new THREE.MeshStandardMaterial({
      envMapIntensity: 0.9,
      metalness: 0,
      roughness: 0.32,
    });
    const cells = model.cells;
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity, minK = Infinity, maxK = -Infinity;
    for (const cell of cells) {
      minI = Math.min(minI, cell.i); maxI = Math.max(maxI, cell.i);
      minJ = Math.min(minJ, cell.j); maxJ = Math.max(maxJ, cell.j);
      minK = Math.min(minK, cell.k); maxK = Math.max(maxK, cell.k);
    }
    const centreI = (minI + maxI) / 2;
    const centreK = (minK + maxK) / 2;
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    for (const [index, cell] of cells.entries()) {
      matrix.makeTranslation(cell.i - centreI, (cell.j - minJ) * layerRatio, cell.k - centreK);
      mesh.setMatrixAt(index, matrix);
      colour.set(cell.colorHex ?? '#A0A19F');
      // Tiny per-brick value variation sells moulded plastic under light.
      const jitter = 1 + (((cell.i * 73856093) ^ (cell.j * 19349663) ^ (cell.k * 83492791)) % 7 - 3) * 0.006;
      colour.multiplyScalar(jitter);
      mesh.setColorAt(index, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);

    const spanI = maxI - minI + 1;
    const spanJ = (maxJ - minJ + 1) * layerRatio;
    const spanK = maxK - minK + 1;
    const radius = Math.max(spanI, spanK) / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 12, radius * 12),
      new THREE.ShadowMaterial({ opacity: 0.42 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const key = new THREE.DirectionalLight('#fff6e8', 2.4);
    key.position.set(radius * 2.2, spanJ * 2.6 + radius, radius * 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowSpan = Math.max(radius * 2.2, spanJ * 1.4);
    key.shadow.camera.left = -shadowSpan;
    key.shadow.camera.right = shadowSpan;
    key.shadow.camera.top = shadowSpan;
    key.shadow.camera.bottom = -shadowSpan;
    key.shadow.camera.far = radius * 12 + spanJ * 6;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#dfe8ff', 0.55);
    rim.position.set(-radius * 2.2, spanJ * 1.8, -radius * 2.4);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, radius * 60 + spanJ * 30);
    // Bounding-sphere fit keeps cars, urns and busts alike filling the frame.
    const sphereRadius = 0.5 * Math.hypot(spanI, spanJ, spanK);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fitDistance = (sphereRadius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.04;
    const lookY = spanJ * 0.48;

    const out: string[] = [];
    for (let frame = 0; frame < frames; frame++) {
      group.rotation.y = -Math.PI / 5 + (frame * Math.PI * 2) / frames;
      const elevationAngle = Math.PI / 9; // ~20° product-shot camera height
      camera.position.set(
        fitDistance * Math.cos(elevationAngle) * 0.35,
        lookY + fitDistance * Math.sin(elevationAngle),
        fitDistance * Math.cos(elevationAngle),
      );
      camera.lookAt(0, lookY, 0);
      renderer.render(scene, camera);
      out.push(canvas.toDataURL('image/png'));
    }

    geometry.dispose();
    material.dispose();
    pmrem.dispose();
    return out;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
