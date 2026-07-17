import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { brickify, type BillOfMaterials, type BrickPlacement } from '../lib/brickify';
import type { VoxelModel } from '../lib/voxelFox';
import { voxelBaseColor } from '../lib/voxelRender';

/**
 * Ultra-realistic WebGL brick stage (web build): instanced beveled bricks
 * with studs, physically-based ABS-style material, soft shadows and studio
 * environment reflections. Drag to orbit; buttons mirror the SVG viewer's
 * accessible controls.
 */

interface ThreeBrickViewProps {
  model: VoxelModel;
  accent: string;
  label?: string;
  /** Pack only the visible shell, matching the standard kit quote. */
  hollow?: boolean;
  /** Expected packed count supplied by the profile cards, used only if packing fails. */
  packedParts?: number;
  /** Frozen order packing, when this preview belongs to an existing order. */
  packedPlan?: BillOfMaterials;
}

const ROTATION_STEP = Math.PI / 8;
const INITIAL_YAW = 0.62;

interface StageHandles {
  dispose: () => void;
  setModel: (model: VoxelModel, accent: string, packed: BillOfMaterials | null) => void;
  setTargetYaw: (yaw: number) => void;
  getTargetYaw: () => number;
}

function createStage(container: HTMLElement): StageHandles {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // No filmic tone mapping: it hue-shifts saturated brick colours
  // (catalog red drifts orange in light, magenta in shade).
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'pan-y';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0E16');
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

  // Near-neutral lights: brick colours must stay true to the catalog —
  // saturated stage lighting shifts red toward magenta/orange.
  const key = new THREE.DirectionalLight('#FFFBF2', 2.3);
  key.position.set(9, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0004;
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#55607A', '#141821', 0.65));
  const rim = new THREE.DirectionalLight('#AEB6CC', 0.4);
  rim.position.set(-8, 6, -9);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshStandardMaterial({ color: '#101422', metalness: 0.1, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(24, 24, 0x2c3450, 0x1a2036);
  grid.position.y = 0.002;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  const brickMaterial = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
    metalness: 0,
    roughness: 0.36,
  });

  /** 45°-style wedge descending toward +z, using the real brick layer pitch. */
  function wedgeGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
    const hx = (width * 0.98) / 2;
    const hy = (height * 0.98) / 2;
    const hz = (depth * 0.98) / 2;
    // prettier-ignore
    const positions = new Float32Array([
      // bottom (y = -h)
      -hx, -hy, -hz,  hx, -hy,  hz,  hx, -hy, -hz,   -hx, -hy, -hz,  -hx, -hy,  hz,  hx, -hy,  hz,
      // back (z = -h)
      -hx, -hy, -hz,  hx, -hy, -hz,  hx,  hy, -hz,   -hx, -hy, -hz,  hx,  hy, -hz,  -hx,  hy, -hz,
      // ramp (top-back edge → bottom-front edge)
      -hx,  hy, -hz,  hx,  hy, -hz,  hx, -hy,  hz,   -hx,  hy, -hz,  hx, -hy,  hz,  -hx, -hy,  hz,
      // right flank (x = +h)
      hx, -hy, -hz,  hx, -hy,  hz,  hx,  hy, -hz,
      // left flank (x = -h)
      -hx, -hy, -hz,  -hx,  hy, -hz,  -hx, -hy,  hz,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Rotation (about Y) that points the wedge's descent at each FACE_DIRECTIONS index. */
  const WEDGE_ROTATION: Record<number, number> = {
    1: 0,
    2: Math.PI,
    3: Math.PI / 2,
    4: -Math.PI / 2,
  };

  let targetYaw = INITIAL_YAW;
  let currentYaw = INITIAL_YAW;
  let modelRadius = 6;
  let modelHeight = 6;

  function frameCamera() {
    const distance = Math.max(modelRadius * 2.4, modelHeight * 1.65) + 3;
    camera.position.set(0, modelHeight * 0.62 + 1.2, distance);
    camera.lookAt(0, modelHeight * 0.42, 0);
  }

  function setModel(model: VoxelModel, accent: string, packed: BillOfMaterials | null) {
    while (modelGroup.children.length) {
      const child = modelGroup.children[0] as THREE.Mesh;
      modelGroup.remove(child);
      child.geometry?.dispose();
    }

    const size = model.size;
    const layerHeight = model.layerHeight ?? size;
    const studGeometry = new THREE.CylinderGeometry(size * 0.3, size * 0.3, size * 0.17, 14);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const boundsCells = model.shell.length ? model.shell : model.cells;
    boundsCells.forEach((voxel) => {
      minX = Math.min(minX, voxel.cx); maxX = Math.max(maxX, voxel.cx);
      minY = Math.min(minY, voxel.cy); maxY = Math.max(maxY, voxel.cy);
      minZ = Math.min(minZ, voxel.cz); maxZ = Math.max(maxZ, voxel.cz);
    });

    if (packed && model.cells.length) {
      const seed = model.cells[0]!;
      const worldX = (i: number) => seed.cx + (i - seed.i) * size;
      const worldY = (j: number) => seed.cy + (j - seed.j) * layerHeight;
      const worldZ = (k: number) => seed.cz + (k - seed.k) * size;
      const colorByPart = new Map(
        packed.lines.map((line) => [`${line.part}|${line.colorId}`, line.colorRgb]),
      );
      const groups = new Map<string, BrickPlacement[]>();
      for (const placement of packed.placements) {
        const key = `${placement.shape}|${placement.spanI}|${placement.spanK}|${placement.facing ?? 0}`;
        const group = groups.get(key) ?? [];
        group.push(placement);
        groups.set(key, group);
      }

      for (const placements of groups.values()) {
        const sample = placements[0]!;
        const facesAlongX = sample.facing === 3 || sample.facing === 4;
        const geometry = sample.shape === 'slope'
          ? wedgeGeometry(
              (facesAlongX ? sample.spanK : sample.spanI) * size,
              layerHeight,
              (facesAlongX ? sample.spanI : sample.spanK) * size,
            )
          : new THREE.BoxGeometry(
              sample.spanI * size - size * 0.02,
              layerHeight * 0.98,
              sample.spanK * size - size * 0.02,
            );
        const pieces = new THREE.InstancedMesh(geometry, brickMaterial, placements.length);
        pieces.castShadow = true;
        pieces.receiveShadow = true;
        placements.forEach((placement, index) => {
          const cx = worldX(placement.i) + ((placement.spanI - 1) * size) / 2;
          const cy = worldY(placement.j);
          const cz = worldZ(placement.k) + ((placement.spanK - 1) * size) / 2;
          if (placement.shape === 'slope') {
            matrix.makeRotationY(WEDGE_ROTATION[placement.facing ?? 1] ?? 0);
            matrix.setPosition(cx, cy, cz);
          } else {
            matrix.makeTranslation(cx, cy, cz);
          }
          pieces.setMatrixAt(index, matrix);
          color.set(colorByPart.get(`${placement.part}|${placement.colorId}`) ?? accent);
          pieces.setColorAt(index, color);
        });
        pieces.instanceMatrix.needsUpdate = true;
        if (pieces.instanceColor) pieces.instanceColor.needsUpdate = true;
        modelGroup.add(pieces);
      }

      const brickPlacements = packed.placements.filter((placement) => placement.shape === 'brick');
      const studCount = brickPlacements.reduce(
        (sum, placement) => sum + placement.spanI * placement.spanK,
        0,
      );
      const studs = new THREE.InstancedMesh(studGeometry, brickMaterial, Math.max(studCount, 1));
      studs.castShadow = true;
      let studIndex = 0;
      for (const placement of brickPlacements) {
        color.set(colorByPart.get(`${placement.part}|${placement.colorId}`) ?? accent);
        for (let di = 0; di < placement.spanI; di++) {
          for (let dk = 0; dk < placement.spanK; dk++) {
            matrix.makeTranslation(
              worldX(placement.i + di),
              worldY(placement.j) + layerHeight * 0.5 + size * 0.085,
              worldZ(placement.k + dk),
            );
            studs.setMatrixAt(studIndex, matrix);
            studs.setColorAt(studIndex, color);
            studIndex++;
          }
        }
      }
      studs.count = studIndex;
      studs.instanceMatrix.needsUpdate = true;
      if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
      modelGroup.add(studs);
    } else {
      // Catalog packing can be unavailable when a stock rule rejects the
      // model. Keep a clear shape fallback instead of leaving a blank stage.
      const cubes = model.shell.filter((voxel) => voxel.shape !== 'slope');
      const wedges = model.shell.filter((voxel) => voxel.shape === 'slope');
      const bricks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(size * 0.98, layerHeight * 0.98, size * 0.98),
        brickMaterial,
        Math.max(cubes.length, 1),
      );
      const slopes = new THREE.InstancedMesh(
        wedgeGeometry(size, layerHeight, size),
        brickMaterial,
        Math.max(wedges.length, 1),
      );
      const visibleStuds = cubes.filter((voxel) => voxel.exposed[0]);
      const studs = new THREE.InstancedMesh(
        studGeometry,
        brickMaterial,
        Math.max(visibleStuds.length, 1),
      );
      cubes.forEach((voxel, index) => {
        matrix.makeTranslation(voxel.cx, voxel.cy, voxel.cz);
        bricks.setMatrixAt(index, matrix);
        color.set(voxelBaseColor(voxel, accent));
        bricks.setColorAt(index, color);
      });
      wedges.forEach((voxel, index) => {
        matrix.makeRotationY(WEDGE_ROTATION[voxel.facing ?? 1] ?? 0);
        matrix.setPosition(voxel.cx, voxel.cy, voxel.cz);
        slopes.setMatrixAt(index, matrix);
        color.set(voxelBaseColor(voxel, accent));
        slopes.setColorAt(index, color);
      });
      visibleStuds.forEach((voxel, index) => {
        matrix.makeTranslation(
          voxel.cx,
          voxel.cy + layerHeight * 0.5 + size * 0.085,
          voxel.cz,
        );
        studs.setMatrixAt(index, matrix);
        color.set(voxelBaseColor(voxel, accent));
        studs.setColorAt(index, color);
      });
      for (const mesh of [bricks, slopes, studs]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        modelGroup.add(mesh);
      }
      bricks.count = cubes.length;
      slopes.count = wedges.length;
      studs.count = visibleStuds.length;
    }

    // Centre the model on the stage with its feet on the floor.
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    modelGroup.position.set(-centerX, -minY + layerHeight / 2, -centerZ);

    modelRadius = Math.max(maxX - minX, maxZ - minZ) / 2 + 1;
    modelHeight = maxY - minY + layerHeight;
    frameCamera();
  }

  // Pointer orbit.
  let dragging = false;
  let lastX = 0;
  const onDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    targetYaw += (event.clientX - lastX) * 0.012;
    lastX = event.clientX;
  };
  const onUp = () => {
    dragging = false;
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointercancel', onUp);

  let disposed = false;
  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function tick() {
    if (disposed) return;
    currentYaw += (targetYaw - currentYaw) * 0.12;
    if (!dragging) targetYaw += 0.0016; // slow idle orbit
    modelGroup.rotation.y = currentYaw;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    dispose: () => {
      disposed = true;
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      pmrem.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
    getTargetYaw: () => targetYaw,
    setModel,
    setTargetYaw: (yaw: number) => {
      targetYaw = yaw;
    },
  };
}

export function ThreeBrickView({
  model,
  accent,
  hollow = false,
  label = 'Realistic 3D brick preview',
  packedParts,
  packedPlan,
}: ThreeBrickViewProps) {
  const containerRef = useRef<View>(null);
  const stageRef = useRef<StageHandles | null>(null);
  const [ready, setReady] = useState(false);
  const packed = useMemo(() => {
    try {
      return packedPlan ?? brickify(model, accent, hollow ? { hollow: true } : {});
    } catch {
      return null;
    }
  }, [accent, hollow, model, packedPlan]);

  useEffect(() => {
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node) return;
    const stage = createStage(node);
    stageRef.current = stage;
    setReady(true);
    return () => {
      stageRef.current = null;
      stage.dispose();
    };
  }, []);

  useEffect(() => {
    if (ready && stageRef.current) {
      stageRef.current.setModel(model, accent, packed);
    }
  }, [accent, model, packed, ready]);

  const rotateBy = (amount: number) => {
    stageRef.current?.setTargetYaw(stageRef.current.getTargetYaw() + amount);
  };

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.liveMark}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>{packed ? 'CATALOG KIT PREVIEW' : 'SHAPE PREVIEW'}</Text>
        </View>
        <Text numberOfLines={1} style={styles.count}>
          {model.shell.length.toLocaleString('en-US')} CELLS
          {(packed?.totalParts ?? packedParts) !== undefined
            ? ` · ${(packed?.totalParts ?? packedParts)!.toLocaleString('en-US')} PARTS`
            : ''}
        </Text>
      </View>
      <View
        accessibilityLabel={label}
        accessibilityRole="image"
        ref={containerRef}
        style={styles.stage}
      />
      <View accessibilityRole="toolbar" style={styles.controls}>
        <Pressable
          accessibilityLabel="Rotate preview left"
          accessibilityRole="button"
          onPress={() => rotateBy(-ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Text style={styles.controlIcon}>←</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Reset preview rotation"
          accessibilityRole="button"
          onPress={() => stageRef.current?.setTargetYaw(INITIAL_YAW)}
          style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
        >
          <Text style={styles.resetText}>RESET VIEW</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Rotate preview right"
          accessibilityRole="button"
          onPress={() => rotateBy(ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Text style={styles.controlIcon}>→</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const isRealisticViewSupported = true;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#10131D',
    borderColor: '#31384D',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#282E40',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  liveMark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  liveDot: {
    backgroundColor: '#C8F04B',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  liveText: {
    color: '#EDF6D3',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.7,
  },
  count: {
    color: '#C8F04B',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  stage: {
    aspectRatio: 1.13,
    backgroundColor: '#0B0E16',
    width: '100%',
  },
  controls: {
    alignItems: 'center',
    borderTopColor: '#282E40',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    padding: 11,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: '#1A1F2D',
    borderColor: '#3A435A',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 48,
  },
  controlIcon: {
    color: '#F6F7FB',
    fontSize: 19,
    fontWeight: '700',
  },
  resetButton: {
    alignItems: 'center',
    backgroundColor: '#7367FF',
    borderRadius: 10,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    maxWidth: 154,
  },
  resetText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  pressed: {
    opacity: 0.68,
  },
});
