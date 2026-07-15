/**
 * Monocular depth estimation (web): Depth Anything V2 small, quantized ONNX,
 * running fully in-browser via onnxruntime-web (WASM). The runtime's .wasm
 * binaries load from the jsDelivr CDN and the ~26 MB model weights stream
 * from HuggingFace on first use, then stay in the browser cache.
 *
 * Output is RELATIVE inverse depth (larger = closer). The voxelizer only
 * needs ordering, so no metric calibration is required.
 */

import { Platform } from 'react-native';

const MODEL_URL =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx';
const ORT_VERSION = '1.27.0';
const INPUT_SIZE = 518; // DINOv2 patch grid: must be a multiple of 14
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Minimal runtime surface of onnxruntime-web. The library is loaded as a
 * CDN script (Metro cannot bundle its pre-built ESM), so no value import
 * of the package may appear in this file.
 */
interface OrtRuntime {
  env: { wasm: { wasmPaths: string } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create: (
      url: string,
      options: { executionProviders: string[]; graphOptimizationLevel: string },
    ) => Promise<OrtSession>;
  };
}

interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
}

let sessionPromise: Promise<{ ort: OrtRuntime; session: OrtSession }> | null = null;

/** Load onnxruntime-web from the CDN as a classic script exposing `ort`. */
function loadOrtScript(): Promise<OrtRuntime> {
  const host = globalThis as unknown as { ort?: OrtRuntime };
  if (host.ort) {
    return Promise.resolve(host.ort);
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`;
    script.onload = () => (host.ort ? resolve(host.ort) : reject(new Error('ort global missing')));
    script.onerror = () => reject(new Error('failed to load onnxruntime-web'));
    document.head.appendChild(script);
  });
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrtScript();
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { ort, session };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null; // allow retry after a network failure
    });
  }
  return sessionPromise;
}

export function isDepthSupported() {
  return Platform.OS === 'web';
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
 * Estimate depth for the selected photo region and return a grid×grid map of
 * relative closeness aligned with the segmentation grid, or null when depth
 * is unsupported or the model cannot be loaded.
 */
export async function estimateDepthGrid(
  uri: string,
  region: Region,
  grid: number,
): Promise<Float32Array | null> {
  if (!isDepthSupported()) {
    return null;
  }

  try {
    const [{ ort, session }, image] = await Promise.all([getSession(), loadImage(uri)]);

    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(
      image,
      region.x * image.naturalWidth,
      region.y * image.naturalHeight,
      region.width * image.naturalWidth,
      region.height * image.naturalHeight,
      0,
      0,
      INPUT_SIZE,
      INPUT_SIZE,
    );
    const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

    const plane = INPUT_SIZE * INPUT_SIZE;
    const input = new Float32Array(3 * plane);
    for (let index = 0; index < plane; index++) {
      input[index] = (pixels[index * 4]! / 255 - MEAN[0]!) / STD[0]!;
      input[plane + index] = (pixels[index * 4 + 1]! / 255 - MEAN[1]!) / STD[1]!;
      input[2 * plane + index] = (pixels[index * 4 + 2]! / 255 - MEAN[2]!) / STD[2]!;
    }

    const feeds: Record<string, unknown> = {
      [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    };
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]!]!;
    const depth = output.data;
    const side = Math.round(Math.sqrt(depth.length));

    // Block-average down to the segmentation grid.
    const out = new Float32Array(grid * grid);
    const scale = side / grid;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        let sum = 0;
        let count = 0;
        const y0 = Math.floor(gy * scale);
        const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * scale));
        const x0 = Math.floor(gx * scale);
        const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * scale));
        for (let y = y0; y < y1 && y < side; y++) {
          for (let x = x0; x < x1 && x < side; x++) {
            sum += depth[y * side + x]!;
            count++;
          }
        }
        out[gy * grid + gx] = count ? sum / count : 0;
      }
    }
    return out;
  } catch {
    return null;
  }
}
