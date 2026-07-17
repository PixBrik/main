import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface RawMeshViewProps {
  fallbackImageUri?: string;
  label?: string;
  modelUrl: string;
  onError?: (message: string) => void;
  onReady?: () => void;
}

interface StageHandles {
  dispose: () => void;
  reset: () => void;
  rotateBy: (amount: number) => void;
}

type ViewerState = 'loading' | 'ready' | 'failed';

const INITIAL_YAW = Math.PI / 8;
const ROTATION_STEP = Math.PI / 4;
const STAGE_BACKGROUND = 0x17130a;

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const nodeMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function createStage(
  container: HTMLElement,
  modelUrl: string,
  onReady: () => void,
  onFailure: (message: string) => void,
): StageHandles {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(STAGE_BACKGROUND, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.width = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STAGE_BACKGROUND);
  scene.add(new THREE.HemisphereLight(0xfffbf2, 0x252c40, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 7, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9cb5ff, 1.15);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 1000);
  const modelGroup = new THREE.Group();
  const contentGroup = new THREE.Group();
  modelGroup.add(contentGroup);
  scene.add(modelGroup);

  let modelRoot: THREE.Object3D | null = null;
  let disposed = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let targetYaw = INITIAL_YAW;
  let currentYaw = INITIAL_YAW;
  let targetPitch = 0;
  let currentPitch = 0;

  const frameModel = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) throw new Error('The generated model contains no visible geometry.');
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const center = bounds.getCenter(new THREE.Vector3());
    contentGroup.position.copy(center).multiplyScalar(-1);
    const radius = Math.max(sphere.radius, 0.001);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (radius / Math.sin(verticalFov / 2)) * 1.08;
    camera.near = Math.max(radius / 100, 0.001);
    camera.far = Math.max(distance + radius * 8, 10);
    camera.position.set(0, radius * 0.12, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  void new GLTFLoader().loadAsync(modelUrl).then(
    (gltf) => {
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      try {
        modelRoot = gltf.scene;
        contentGroup.add(modelRoot);
        frameModel(modelRoot);
      } catch (error) {
        disposeObject(gltf.scene);
        contentGroup.remove(gltf.scene);
        modelRoot = null;
        onFailure(error instanceof Error ? error.message : 'The generated GLB could not be displayed.');
        return;
      }
      onReady();
    },
    (error: unknown) => {
      if (!disposed) {
        onFailure(error instanceof Error ? error.message : 'The generated GLB could not be loaded.');
      }
    },
  );

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    targetYaw += (event.clientX - lastX) * 0.012;
    targetPitch = THREE.MathUtils.clamp(targetPitch + (event.clientY - lastY) * 0.006, -0.55, 0.55);
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let animationFrame = 0;
  const tick = () => {
    if (disposed) return;
    currentYaw += (targetYaw - currentYaw) * 0.12;
    currentPitch += (targetPitch - currentPitch) * 0.12;
    if (!dragging && !reduceMotion && modelRoot) targetYaw += 0.0014;
    modelGroup.rotation.set(currentPitch, currentYaw, 0);
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      if (modelRoot) disposeObject(modelRoot);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    },
    reset: () => {
      targetPitch = 0;
      targetYaw = INITIAL_YAW;
    },
    rotateBy: (amount: number) => {
      targetYaw += amount;
    },
  };
}

/** Interactive provider-GLB approval view. Drag horizontally or vertically to inspect every surface. */
export function RawMeshView({
  fallbackImageUri,
  label = 'Interactive generated raw 3D model',
  modelUrl,
  onError,
  onReady,
}: RawMeshViewProps) {
  const containerRef = useRef<View>(null);
  const stageRef = useRef<StageHandles | null>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const notifiedModelRef = useRef('');
  const [viewerState, setViewerState] = useState<ViewerState>('loading');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  }, [onError, onReady]);

  useEffect(() => {
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node) return;
    setViewerState('loading');
    setFailure('');
    let mounted = true;
    let stage: StageHandles;
    try {
      stage = createStage(
        node,
        modelUrl,
        () => {
          if (!mounted) return;
          setViewerState('ready');
          if (notifiedModelRef.current !== modelUrl) {
            notifiedModelRef.current = modelUrl;
            onReadyRef.current?.();
          }
        },
        (message) => {
          if (!mounted) return;
          setFailure(message);
          setViewerState('failed');
          onErrorRef.current?.(message);
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Interactive 3D is unavailable in this browser.';
      setFailure(message);
      setViewerState('failed');
      onErrorRef.current?.(message);
      return;
    }
    stageRef.current = stage;
    return () => {
      mounted = false;
      stageRef.current = null;
      stage.dispose();
    };
  }, [modelUrl]);

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.liveMark}>
          <View style={[styles.liveDot, viewerState === 'failed' && styles.failedDot]} />
          <Text style={styles.liveText}>
            {viewerState === 'ready' ? 'LIVE 3D MODEL' : viewerState === 'failed' ? '3D STILL FALLBACK' : 'LOADING 3D MODEL'}
          </Text>
        </View>
        <Text style={styles.hint}>DRAG TO ROTATE</Text>
      </View>
      <View style={styles.stageShell}>
        <View
          accessibilityHint="Drag left, right, up or down to inspect the generated model"
          accessibilityLabel={label}
          accessibilityRole="image"
          ref={containerRef}
          style={styles.stage}
        />
        {viewerState !== 'ready' && fallbackImageUri ? (
          <Image
            accessibilityLabel={`${label}, front-view fallback`}
            resizeMode="contain"
            source={{ uri: fallbackImageUri }}
            style={styles.fallback}
          />
        ) : null}
        {viewerState === 'loading' ? (
          <View pointerEvents="none" style={styles.overlay}>
            <Text style={styles.overlayTitle}>Opening your 3D model…</Text>
            <Text style={styles.overlayText}>The generated mesh is preserved while this view loads.</Text>
          </View>
        ) : null}
        {viewerState === 'failed' && !fallbackImageUri ? (
          <View pointerEvents="none" style={styles.overlay}>
            <Text style={styles.overlayTitle}>Interactive view unavailable</Text>
            <Text style={styles.overlayText}>{failure || 'Use the four approval stills below.'}</Text>
          </View>
        ) : null}
      </View>
      <View accessibilityRole="toolbar" style={styles.controls}>
        <Pressable
          accessibilityLabel="Rotate raw model left"
          accessibilityRole="button"
          disabled={viewerState !== 'ready'}
          onPress={() => stageRef.current?.rotateBy(-ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, viewerState !== 'ready' && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.controlIcon}>←</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Reset raw model view"
          accessibilityRole="button"
          disabled={viewerState !== 'ready'}
          onPress={() => stageRef.current?.reset()}
          style={({ pressed }) => [styles.resetButton, viewerState !== 'ready' && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.resetText}>RESET VIEW</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Rotate raw model right"
          accessibilityRole="button"
          disabled={viewerState !== 'ready'}
          onPress={() => stageRef.current?.rotateBy(ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, viewerState !== 'ready' && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.controlIcon}>→</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const isInteractiveRawMeshViewSupported = true;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#10131D',
    borderColor: '#384158',
    borderRadius: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  liveMark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  liveDot: {
    backgroundColor: '#C8F04B',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  failedDot: {
    backgroundColor: '#FFC400',
  },
  liveText: {
    color: '#F6F7FB',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  hint: {
    color: '#C8F04B',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  stageShell: {
    aspectRatio: 1.15,
    backgroundColor: '#17130A',
    position: 'relative',
    width: '100%',
  },
  stage: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  fallback: {
    backgroundColor: '#17130A',
    bottom: 0,
    height: '100%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 22, 0.76)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  overlayTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  overlayText: {
    color: '#B9C1D3',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
    maxWidth: 270,
    textAlign: 'center',
  },
  controls: {
    alignItems: 'center',
    borderTopColor: '#282E40',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    padding: 10,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: '#1A1F2D',
    borderColor: '#3A435A',
    borderRadius: 9,
    borderWidth: 1,
    height: 42,
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
    backgroundColor: '#C8F04B',
    borderRadius: 9,
    flex: 1,
    height: 42,
    justifyContent: 'center',
    maxWidth: 154,
  },
  resetText: {
    color: '#10131D',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.25,
  },
  disabled: {
    opacity: 0.38,
  },
  pressed: {
    opacity: 0.68,
  },
});
