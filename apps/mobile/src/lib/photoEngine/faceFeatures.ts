/**
 * Face landmark detection (web): MediaPipe FaceDetector via the
 * @tensorflow-models/face-detection wrapper, solution files streamed from
 * jsDelivr. Returns the six canonical keypoints — both eyes, nose tip,
 * mouth centre, both ear tragions — in coordinates relative to the selected
 * region, so the voxelizer can stamp guaranteed facial features.
 */

import { Platform } from 'react-native';

export interface FacePoint {
  x: number;
  y: number;
}

export interface FaceContours {
  leftEye: FacePoint[];
  rightEye: FacePoint[];
  lips: FacePoint[];
  leftBrow: FacePoint[];
  rightBrow: FacePoint[];
}

export interface FaceKeypoints {
  /** All coordinates are fractions of the selected region (0..1). */
  leftEye: FacePoint;
  rightEye: FacePoint;
  noseTip: FacePoint;
  mouth: FacePoint;
  leftEar: FacePoint | null;
  rightEar: FacePoint | null;
  /** Full region outlines when FaceMesh (468 landmarks) is available. */
  contours?: FaceContours;
}

/** Canonical MediaPipe FaceMesh landmark indices for the feature outlines. */
const MESH = {
  leftBrow: [70, 63, 105, 66, 107],
  leftEar: 234,
  leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  lips: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  mouthCenter: 13,
  noseTip: 1,
  rightBrow: [336, 296, 334, 293, 300],
  rightEar: 454,
  rightEye: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
} as const;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

let detectorPromise: Promise<unknown> | null = null;
let meshPromise: Promise<unknown> | null = null;

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const faceDetection = await import('@tensorflow-models/face-detection');
      return faceDetection.createDetector(faceDetection.SupportedModels.MediaPipeFaceDetector, {
        maxFaces: 1,
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection',
      });
    })();
    detectorPromise.catch(() => {
      detectorPromise = null;
    });
  }
  return detectorPromise;
}

async function getMesh() {
  if (!meshPromise) {
    meshPromise = (async () => {
      const landmarks = await import('@tensorflow-models/face-landmarks-detection');
      return landmarks.createDetector(landmarks.SupportedModels.MediaPipeFaceMesh, {
        maxFaces: 1,
        refineLandmarks: false,
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
      });
    })();
    meshPromise.catch(() => {
      meshPromise = null;
    });
  }
  return meshPromise;
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = uri;
  });
}

/**
 * MediaPipe's own graphs downsample to ~128-192px internally regardless of
 * input size, so feeding it a near-native-resolution canvas (thousands of px
 * for a modern phone photo) buys nothing but a long synchronous WASM run on
 * the main thread — this is the primary cause of the reported freeze on real
 * photos. Cap the canvas so the draw and the detector both stay cheap.
 */
const MAX_FACE_CANVAS_DIM = 480;

function cropToCanvas(image: HTMLImageElement, region: Region): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const sourceWidth = region.width * image.naturalWidth;
  const sourceHeight = region.height * image.naturalHeight;
  const scale = Math.min(1, MAX_FACE_CANVAS_DIM / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(64, Math.round(sourceWidth * scale));
  canvas.height = Math.max(64, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(
    image,
    region.x * image.naturalWidth,
    region.y * image.naturalHeight,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

interface EstimatedFace {
  keypoints: Array<{ x: number; y: number; name?: string }>;
}

/** FaceMesh path: 468 landmarks → precise feature contours. */
async function tryFaceMesh(canvas: HTMLCanvasElement): Promise<FaceKeypoints | null> {
  try {
    const mesh = await getMesh();
    const faces = await (mesh as { estimateFaces: (i: HTMLCanvasElement) => Promise<EstimatedFace[]> }).estimateFaces(canvas);
    const keypoints = faces[0]?.keypoints;
    if (!keypoints || keypoints.length < 468) return null;

    const norm = (index: number): FacePoint => ({
      x: keypoints[index]!.x / canvas.width,
      y: keypoints[index]!.y / canvas.height,
    });
    const ring = (indices: readonly number[]): FacePoint[] => indices.map(norm);
    const centroid = (points: FacePoint[]): FacePoint => ({
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    });

    const leftEyeRing = ring(MESH.leftEye);
    const rightEyeRing = ring(MESH.rightEye);
    const lipsRing = ring(MESH.lips);

    return {
      contours: {
        leftBrow: ring(MESH.leftBrow),
        leftEye: leftEyeRing,
        lips: lipsRing,
        rightBrow: ring(MESH.rightBrow),
        rightEye: rightEyeRing,
      },
      leftEar: norm(MESH.leftEar),
      leftEye: centroid(leftEyeRing),
      mouth: norm(MESH.mouthCenter),
      noseTip: norm(MESH.noseTip),
      rightEar: norm(MESH.rightEar),
      rightEye: centroid(rightEyeRing),
    };
  } catch {
    return null;
  }
}

/** BlazeFace fallback: the six canonical keypoints, no contours. */
async function tryFaceDetector(canvas: HTMLCanvasElement): Promise<FaceKeypoints | null> {
  try {
    const detector = await getDetector();
    const faces = await (detector as { estimateFaces: (i: HTMLCanvasElement) => Promise<EstimatedFace[]> }).estimateFaces(canvas);
    const face = faces[0];
    if (!face) return null;

    const byName = new Map(face.keypoints.map((kp) => [kp.name ?? '', { x: kp.x / canvas.width, y: kp.y / canvas.height }]));
    const leftEye = byName.get('leftEye');
    const rightEye = byName.get('rightEye');
    const noseTip = byName.get('noseTip');
    const mouth = byName.get('mouthCenter');
    if (!leftEye || !rightEye || !noseTip || !mouth) return null;

    return {
      leftEar: byName.get('leftEarTragion') ?? null,
      leftEye,
      mouth,
      noseTip,
      rightEar: byName.get('rightEarTragion') ?? null,
      rightEye,
    };
  } catch {
    return null;
  }
}

export async function detectFaceKeypoints(uri: string, region: Region): Promise<FaceKeypoints | null> {
  if (Platform.OS !== 'web') {
    return null;
  }
  try {
    const image = await loadImage(uri);
    const canvas = cropToCanvas(image, region);
    if (!canvas) return null;
    // FaceMesh first for contour-level precision; BlazeFace as fallback.
    return (await tryFaceMesh(canvas)) ?? (await tryFaceDetector(canvas));
  } catch {
    return null;
  }
}
