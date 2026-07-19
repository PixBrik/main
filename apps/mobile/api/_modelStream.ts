/**
 * Stream provider GLBs without buffering them inside a Vercel Function.
 *
 * Real high-detail models routinely exceed Vercel's 4.5 MB buffered response
 * limit. Keeping this as a true Node stream also preserves provider URL
 * privacy and avoids relying on undocumented provider-CDN browser CORS.
 */

import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_PROVIDER_MODEL_BYTES = 128 * 1024 * 1024;

export class ModelStreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModelStreamError';
  }
}

function declaredBytes(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Pipe one successful provider response to the browser with backpressure.
 * `pipeline` destroys the upstream Readable when the downstream disconnects.
 */
export async function streamProviderModel(response: Response, res: any): Promise<void> {
  if (!response.ok) {
    throw new ModelStreamError(`model download failed (${response.status})`, 502);
  }
  if (!response.body) {
    throw new ModelStreamError('model download returned no body', 502);
  }
  const length = declaredBytes(response);
  if (length === 0 || (length !== null && length > MAX_PROVIDER_MODEL_BYTES)) {
    throw new ModelStreamError('generated model is outside the supported size', 502);
  }
  const providerType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (providerType.includes('text/html') || providerType.includes('application/json')) {
    throw new ModelStreamError('model download returned an invalid file', 502);
  }

  const upstream = Readable.fromWeb(response.body as any);
  let streamedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      streamedBytes += chunk.byteLength;
      if (streamedBytes > MAX_PROVIDER_MODEL_BYTES) {
        callback(new ModelStreamError('generated model is outside the supported size', 502));
        return;
      }
      callback(null, chunk);
    },
  });
  const abortUpstream = () => {
    if (!res.writableEnded && !upstream.destroyed) {
      upstream.destroy(new Error('model download cancelled'));
    }
  };
  res.once?.('close', abortUpstream);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline; filename="pixbrik-model.glb"');
  // Do not forward Content-Length: an explicitly streamed response is what
  // bypasses the normal buffered Function payload limit.
  res.flushHeaders?.();
  try {
    await pipeline(upstream, sizeLimit, res);
  } finally {
    res.off?.('close', abortUpstream);
  }
}

/** A partial streamed response cannot be replaced with JSON safely. */
export function modelResponseStarted(res: any): boolean {
  return !!(res.headersSent || res.writableEnded || res.destroyed);
}
