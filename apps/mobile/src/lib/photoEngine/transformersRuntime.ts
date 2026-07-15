/**
 * Shared Transformers.js runtime: loaded once from the CDN as a browser ES
 * module. Metro cannot bundle the library, so the import is evaluated at
 * runtime where the bundler never sees it. All models loaded through this
 * runtime stream from HuggingFace and stay in the browser cache.
 */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

export interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
  SamModel: { from_pretrained: (id: string, opts: { dtype: string }) => Promise<unknown> };
  AutoProcessor: { from_pretrained: (id: string) => Promise<unknown> };
  RawImage: { read: (uri: string) => Promise<{ width: number; height: number }> };
  env: { backends: { onnx: { wasm: { proxy: boolean } } } };
}

let modulePromise: Promise<TransformersModule> | null = null;

export function loadTransformers(): Promise<TransformersModule> {
  if (!modulePromise) {
    // Runtime URL import — deliberately invisible to Metro.
    modulePromise = (new Function(`return import('${TRANSFORMERS_URL}')`)() as Promise<TransformersModule>).then(
      (transformers) => {
        // CRITICAL: run ONNX inference in a worker. Without this, single-thread
        // WASM inference blocks the main thread for 30-60+ s per model call and
        // the whole tab reads as frozen (observed live on pixbrik.com).
        try {
          transformers.env.backends.onnx.wasm.proxy = true;
        } catch {
          // Older builds without the flag still work, just on-thread.
        }
        return transformers;
      },
    );
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}
