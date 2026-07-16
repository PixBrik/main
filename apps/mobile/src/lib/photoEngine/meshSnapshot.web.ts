/**
 * Raw-mesh snapshots (web). Renders a GLB to a few still images from set
 * angles — used by the model lab to show what actually came out of a 3D
 * engine BEFORE our brick conversion, so mesh quality and conversion quality
 * can be judged separately.
 *
 * Renders offscreen with a throwaway WebGL context per call (created,
 * rendered, disposed) — cards never hold live contexts, so any number of
 * candidates can carry snapshots.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SHOT_W = 460;
const SHOT_H = 400;
/** Orbit angles (radians around Y): front three-quarter, side, back quarter. */
const ANGLES = [0.45, Math.PI / 2 + 0.6, Math.PI + 0.45];

export async function snapshotGlb(url: string): Promise<string[]> {
  if (typeof document === 'undefined') return [];
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;

  const scene = new THREE.Scene();
  scene.add(root);
  // Neutral light so the mesh's own colours read true (no tone-map hue shift).
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(key);

  const bounds = new THREE.Box3().setFromObject(root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const distance = Math.max(1e-6, sphere.radius) * 2.4;

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
  renderer.setSize(SHOT_W, SHOT_H, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x17130a, 1);

  const camera = new THREE.PerspectiveCamera(
    40,
    SHOT_W / SHOT_H,
    Math.max(1e-4, sphere.radius / 50),
    sphere.radius * 20 + distance,
  );

  const shots: string[] = [];
  try {
    for (const angle of ANGLES) {
      camera.position.set(
        center.x + distance * Math.sin(angle),
        center.y + sphere.radius * 0.55,
        center.z + distance * Math.cos(angle),
      );
      camera.lookAt(center);
      key.position.copy(camera.position);
      renderer.render(scene, camera);
      shots.push(canvas.toDataURL('image/png'));
    }
  } finally {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          (material as THREE.MeshStandardMaterial).map?.dispose();
          material?.dispose();
        }
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return shots;
}
