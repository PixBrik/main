/**
 * POST /api/guides/share — publish a sanitized guide snapshot to Vercel Blob.
 * GET  /api/guides/share?id=… — resolve and validate one unguessable guide.
 *
 * Blob objects are public bearer links addressed by unguessable 128-bit ids.
 * The API never accepts customer/order/provider fields, and clean-browser
 * reads revalidate the complete snapshot and expiry. Production retention
 * must also delete expired objects from the connected store.
 */

import { del, get, put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

import {
  createPublishedGuideSnapshot,
  GUIDE_SHARE_ID_PATTERN,
  GUIDE_SHARE_MAX_BYTES,
  GUIDE_SHARE_VERSION,
  guideSharePath,
  parseGuideShareDraft,
  parsePublishedGuideSnapshot,
  type GuideShareError,
} from '../../src/lib/guideShare';

export const GUIDE_SHARE_DEFAULT_TTL_DAYS = 30;
export const GUIDE_SHARE_MAX_TTL_DAYS = 90;
export const GUIDE_SHARE_BLOB_PREFIX = `guides/v${GUIDE_SHARE_VERSION}`;

// This limits Next-compatible hosts before JSON parsing. Standalone Vercel
// functions also run the byte-counted body reader below.
export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

function sendJson(res: any, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function guideBlobToken(env: Record<string, string | undefined> = process.env): string {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new HttpError('Guide sharing is not configured on the server.', 503);
  return token;
}

export function guideTtlDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GUIDE_SHARE_TTL_DAYS?.trim();
  if (!raw) return GUIDE_SHARE_DEFAULT_TTL_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > GUIDE_SHARE_MAX_TTL_DAYS) {
    throw new HttpError('Guide sharing expiry is not configured correctly.', 503);
  }
  return parsed;
}

function safeOrigin(value: string): string | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Build the QR target without trusting an arbitrary forwarded Host header. */
export function guideAppOrigin(
  req: any,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.GUIDE_SHARE_APP_URL?.trim();
  if (configured) {
    const origin = safeOrigin(configured);
    if (!origin) throw new HttpError('Guide sharing URL is not configured correctly.', 503);
    return origin;
  }
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) {
    const origin = safeOrigin(productionHost);
    if (!origin) throw new HttpError('Guide sharing URL is not configured correctly.', 503);
    return origin;
  }

  // Local development fallback only. Production must use one of the trusted
  // environment variables above, preventing Host-header QR injection.
  const host = headerValue(req.headers?.host).trim();
  if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) {
    throw new HttpError('Guide sharing URL is not configured on the server.', 503);
  }
  const forwarded = headerValue(req.headers?.['x-forwarded-proto']).split(',')[0]?.trim();
  const protocol = forwarded === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function byteLength(value: string | Buffer): number {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
}

async function readBody(req: any): Promise<string> {
  const declared = Number(headerValue(req.headers?.['content-length']));
  if (Number.isFinite(declared) && declared > GUIDE_SHARE_MAX_BYTES) {
    throw new HttpError('The guide payload is too large.', 413);
  }
  const contentType = headerValue(req.headers?.['content-type']).toLowerCase();
  if (contentType && !contentType.startsWith('application/json')) {
    throw new HttpError('Guide publishing expects JSON.', 415);
  }

  if (req.body !== undefined && req.body !== null) {
    const ready = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    if (byteLength(ready) > GUIDE_SHARE_MAX_BYTES) throw new HttpError('The guide payload is too large.', 413);
    return Buffer.isBuffer(ready) ? ready.toString('utf8') : ready;
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    throw new HttpError('A JSON guide payload is required.', 400);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > GUIDE_SHARE_MAX_BYTES) throw new HttpError('The guide payload is too large.', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function readBlobText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > GUIDE_SHARE_MAX_BYTES) throw new HttpError('The stored guide is too large.', 502);
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

function requestGuideId(req: any): string {
  const queryValue = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  let id = typeof queryValue === 'string' ? queryValue : '';
  if (!id && typeof req.url === 'string') {
    try {
      id = new URL(req.url, 'https://pixbrik.invalid').searchParams.get('id') ?? '';
    } catch {
      id = '';
    }
  }
  if (!GUIDE_SHARE_ID_PATTERN.test(id)) throw new HttpError('The guide id is invalid.', 400);
  return id;
}

function blobPath(id: string): string {
  return `${GUIDE_SHARE_BLOB_PREFIX}/${id}.json`;
}

async function publish(req: any, res: any, token: string): Promise<void> {
  const raw = await readBody(req);
  let submitted: unknown;
  try {
    submitted = JSON.parse(raw);
  } catch {
    throw new HttpError('The guide payload is not valid JSON.', 400);
  }
  let draft;
  try {
    draft = parseGuideShareDraft(submitted);
  } catch (error) {
    throw new HttpError((error as Error).message || 'The guide payload is invalid.', 400);
  }
  const snapshot = createPublishedGuideSnapshot(draft, { ttlDays: guideTtlDays() });
  const body = JSON.stringify(snapshot);
  if (byteLength(body) > GUIDE_SHARE_MAX_BYTES) throw new HttpError('The guide payload is too large.', 413);

  const id = randomBytes(16).toString('base64url');
  const appOrigin = guideAppOrigin(req);
  await put(blobPath(id), body, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: 'application/json; charset=utf-8',
    maximumSizeInBytes: GUIDE_SHARE_MAX_BYTES,
    token,
  });
  const url = `${appOrigin}${guideSharePath(id)}`;
  sendJson(res, 201, { expiresAt: snapshot.expiresAt, id, url });
}

async function load(req: any, res: any, token: string): Promise<void> {
  const id = requestGuideId(req);
  const result = await get(blobPath(id), { access: 'public', token, useCache: false });
  if (!result || result.statusCode === 304 || !result.stream) {
    throw new HttpError('This shared guide was not found.', 404);
  }
  if (result.blob.size !== null && result.blob.size > GUIDE_SHARE_MAX_BYTES) {
    throw new HttpError('The stored guide is too large.', 502);
  }
  let snapshot;
  try {
    const raw = await readBlobText(result.stream);
    snapshot = parsePublishedGuideSnapshot(JSON.parse(raw));
  } catch (error) {
    if ((error as GuideShareError).status === 410) {
      try {
        await del(blobPath(id), { token });
      } catch {
        // Expiry remains enforced even when best-effort storage cleanup fails.
      }
      throw new HttpError('This shared guide has expired.', 410);
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError('The stored guide is invalid.', 502);
  }
  sendJson(res, 200, snapshot);
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Use GET or POST' });
    return;
  }

  try {
    const token = guideBlobToken();
    if (req.method === 'POST') await publish(req, res, token);
    else await load(req, res, token);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    sendJson(res, 500, { error: 'Guide sharing failed unexpectedly.' });
  }
}
