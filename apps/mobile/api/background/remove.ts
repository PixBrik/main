/**
 * POST /api/background/remove
 *
 * Accepts one cropped PNG as multipart field `image` and proxies it to the
 * configured background-removal provider. Image bytes live only in memory;
 * this route does not log or persist request/response bodies.
 */

const PHOTOROOM_ENDPOINT = 'https://sdk.photoroom.com/v1/segment';
const REMOVE_BG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';

export const BACKGROUND_REMOVAL_TIMEOUT_MS = 15_000;
export const MAX_BACKGROUND_INPUT_BYTES = 6 * 1024 * 1024;
export const MAX_BACKGROUND_INPUT_EDGE = 1024;

// Keep multipart bytes available to this handler when hosted through a
// Next-compatible Vercel runtime. Standalone Vercel Node functions ignore
// this harmlessly and expose the request stream directly.
export const config = { api: { bodyParser: false } };

export type BackgroundRemovalProvider = 'photoroom' | 'removebg';

interface ProviderSelection {
  key: string;
  provider: BackgroundRemovalProvider;
}

interface ProviderRequestSettings {
  endpoint: string;
  fields: ReadonlyArray<readonly [string, string]>;
  keyHeader: 'x-api-key' | 'X-Api-Key';
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function configuredKey(
  provider: BackgroundRemovalProvider,
  env: Record<string, string | undefined>,
): string | undefined {
  const value = provider === 'photoroom' ? env.PHOTOROOM_API_KEY : env.REMOVE_BG_API_KEY;
  return value?.trim() || undefined;
}

/** Select the requested provider, falling back only to another configured key. */
export function selectBackgroundRemovalProvider(
  env: Record<string, string | undefined> = process.env,
): ProviderSelection {
  const requested = env.BACKGROUND_REMOVAL_PROVIDER?.trim().toLowerCase();
  if (requested && requested !== 'photoroom' && requested !== 'removebg') {
    throw new HttpError('Background removal is not configured correctly.', 503);
  }

  const preferred = requested as BackgroundRemovalProvider | undefined;
  const order: BackgroundRemovalProvider[] = preferred
    ? [preferred, preferred === 'photoroom' ? 'removebg' : 'photoroom']
    : ['photoroom', 'removebg'];

  for (const provider of order) {
    const key = configuredKey(provider, env);
    if (key) return { key, provider };
  }
  throw new HttpError('Smart isolate is not configured on the server.', 503);
}

/** Provider-specific request details; kept separate so they can be tested offline. */
export function providerRequestSettings(
  provider: BackgroundRemovalProvider,
  subjectHint?: string,
): ProviderRequestSettings {
  if (provider === 'photoroom') {
    return {
      endpoint: PHOTOROOM_ENDPOINT,
      fields: [
        ['format', 'png'],
        ['channels', 'rgba'],
        ['size', 'medium'],
        ['crop', 'false'],
        ['despill', 'false'],
      ],
      keyHeader: 'x-api-key',
    };
  }
  const normalizedHint = subjectHint?.trim().toLowerCase() ?? '';
  const semanticType = /\b(person|portrait|human)\b/.test(normalizedHint)
    ? 'person'
    : /\b(animal|pet|dog|cat)\b/.test(normalizedHint)
      ? 'animal'
      : /\b(vehicle|car|transportation)\b/.test(normalizedHint)
        ? 'transportation'
        : undefined;
  return {
    endpoint: REMOVE_BG_ENDPOINT,
    fields: [
      ['format', 'png'],
      // `preview` is only 0.25 MP and visibly damages hair, fur, spokes, and
      // product edges. `auto` preserves our <=1 MP crop at full resolution.
      ['size', 'auto'],
      ...(semanticType ? ([['type', semanticType]] as const) : []),
    ],
    keyHeader: 'X-Api-Key',
  };
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

async function readRequestBody(req: any): Promise<Buffer> {
  const declared = Number(headerValue(req.headers?.['content-length']));
  if (Number.isFinite(declared) && declared > MAX_BACKGROUND_INPUT_BYTES) {
    throw new HttpError('The cropped image is too large.', 413);
  }

  const readyBody = req.body;
  if (Buffer.isBuffer(readyBody)) {
    if (readyBody.length > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413);
    }
    return readyBody;
  }
  if (typeof readyBody === 'string' || readyBody instanceof Uint8Array) {
    const buffer = Buffer.from(readyBody);
    if (buffer.length > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413);
    }
    return buffer;
  }

  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    throw new HttpError('Expected a multipart PNG upload.', 400);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function multipartBoundary(contentType: string): string {
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError('Expected a multipart PNG upload.', 415);
  }
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw new HttpError('The multipart boundary is invalid.', 400);
  }
  return boundary;
}

/** Extract the `image` PNG without decoding binary bytes as text. */
export function extractMultipartPng(body: Buffer, contentType: string): Buffer {
  const boundary = multipartBoundary(contentType);
  const marker = Buffer.from(`--${boundary}`);
  const nextMarker = Buffer.from(`\r\n--${boundary}`);
  const headerBreak = Buffer.from('\r\n\r\n');
  let markerIndex = body.indexOf(marker);

  while (markerIndex !== -1) {
    let headerStart = markerIndex + marker.length;
    if (body.subarray(headerStart, headerStart + 2).toString('ascii') === '--') break;
    if (body.subarray(headerStart, headerStart + 2).toString('ascii') !== '\r\n') {
      throw new HttpError('The multipart upload is malformed.', 400);
    }
    headerStart += 2;
    const headerEnd = body.indexOf(headerBreak, headerStart);
    if (headerEnd === -1) throw new HttpError('The multipart upload is malformed.', 400);
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + headerBreak.length;
    const dataEnd = body.indexOf(nextMarker, dataStart);
    if (dataEnd === -1) throw new HttpError('The multipart upload is malformed.', 400);

    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? '';
    const name = disposition.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    if (name === 'image') {
      const partType = headers.match(/content-type:\s*([^;\r\n]+)/i)?.[1]?.trim().toLowerCase();
      if (partType !== 'image/png') {
        throw new HttpError('The cropped image must be a PNG.', 415);
      }
      return body.subarray(dataStart, dataEnd);
    }
    // `dataEnd` points at the CRLF immediately before the next marker.
    markerIndex = dataEnd + 2;
  }

  throw new HttpError('Multipart field `image` is required.', 400);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Validate encoded size and the dimensions in the PNG IHDR. */
export function validatePngInput(png: Buffer): { height: number; width: number } {
  if (png.length > MAX_BACKGROUND_INPUT_BYTES) {
    throw new HttpError('The cropped image is too large.', 413);
  }
  if (
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new HttpError('The uploaded file is not a valid PNG.', 415);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_BACKGROUND_INPUT_EDGE ||
    height > MAX_BACKGROUND_INPUT_EDGE ||
    width * height > MAX_BACKGROUND_INPUT_EDGE * MAX_BACKGROUND_INPUT_EDGE
  ) {
    throw new HttpError('The cropped image must be at most 1024 pixels on its longest edge.', 413);
  }
  return { height, width };
}

function sendJson(res: any, status: number, error: string): void {
  res.status(status).json({ error });
}

function upstreamErrorStatus(status: number): number {
  if (status === 402 || status === 429) return status;
  if (status === 401 || status === 403) return 503;
  return 502;
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, 'Use POST');
    return;
  }

  try {
    const body = await readRequestBody(req);
    const png = extractMultipartPng(body, headerValue(req.headers?.['content-type']));
    validatePngInput(png);

    const { key, provider } = selectBackgroundRemovalProvider();
    const subjectHint = headerValue(req.headers?.['x-pixbrik-subject-hint']);
    const settings = providerRequestSettings(provider, subjectHint);
    const form = new FormData();
    form.append('image_file', new Blob([png], { type: 'image/png' }), 'crop.png');
    for (const [name, value] of settings.fields) form.append(name, value);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BACKGROUND_REMOVAL_TIMEOUT_MS);
    try {
      const upstream = await fetch(settings.endpoint, {
        body: form,
        headers: { [settings.keyHeader]: key },
        method: 'POST',
        signal: controller.signal,
      });

      if (!upstream.ok) {
        const status = upstreamErrorStatus(upstream.status);
        const message =
          upstream.status === 402
            ? 'Smart isolate has no service credit.'
            : upstream.status === 429
              ? 'Smart isolate is busy. Please try again shortly.'
              : status === 503
                ? 'Smart isolate is not configured correctly.'
                : 'The background-removal service could not process this image.';
        throw new HttpError(message, status);
      }

      // Keep the abort signal alive until the complete PNG body has arrived.
      const result = Buffer.from(await upstream.arrayBuffer());
      if (
        result.length < PNG_SIGNATURE.length ||
        !result.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      ) {
        throw new HttpError('The background-removal service returned an invalid image.', 502);
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Background-Removal-Provider', provider);
      res.status(200).send(result);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.message);
      return;
    }
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      sendJson(res, 504, 'Smart isolate timed out. Please try again.');
      return;
    }
    sendJson(res, 500, 'Smart isolate failed unexpectedly.');
  }
}
