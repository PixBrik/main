/**
 * POST /api/background/remove
 *
 * Accepts one cropped PNG as multipart field `image` and proxies it to the
 * configured background-removal provider. Image bytes live only in memory;
 * this route does not log or persist request/response bodies.
 *
 * The in-process limits below are fast circuit breakers for warm functions.
 * Production must also enforce distributed Vercel Firewall rate limits and a
 * durable provider budget; see docs/background-removal-security.md.
 */

import { createHash } from 'node:crypto';

const PHOTOROOM_ENDPOINT = 'https://sdk.photoroom.com/v1/segment';
const REMOVE_BG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';

export const BACKGROUND_REMOVAL_TIMEOUT_MS = 15_000;
export const MAX_BACKGROUND_INPUT_BYTES = 6 * 1024 * 1024;
export const MAX_BACKGROUND_INPUT_EDGE = 1024;
export const BACKGROUND_REMOVAL_RATE_WINDOW_MS = 60 * 60 * 1_000;
export const DEFAULT_BACKGROUND_REMOVAL_IP_HOURLY_LIMIT = 10;
export const DEFAULT_BACKGROUND_REMOVAL_DAILY_LIMIT = 200;

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

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const ipRateBuckets = new Map<string, RateBucket>();
let dailyProviderBucket: RateBucket | null = null;

function configurationError(): HttpError {
  return new HttpError(
    'Smart isolate is not configured correctly.',
    503,
    'background_removal_misconfigured',
  );
}

function configuredPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw configurationError();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw configurationError();
  }
  return parsed;
}

function canonicalOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
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

/** Parse only explicitly configured browser origins and reject bad entries. */
export function allowedBackgroundRemovalOrigins(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const origins = new Set<string>();
  const configured = env.BACKGROUND_REMOVAL_ALLOWED_ORIGINS;
  if (configured !== undefined && configured.trim() !== '') {
    for (const entry of configured.split(',')) {
      const raw = entry.trim();
      const origin = raw ? canonicalOrigin(raw) : null;
      if (!origin) throw configurationError();
      origins.add(origin);
    }
  }
  if (env.NODE_ENV !== 'production') {
    origins.add('http://localhost:8081');
    origins.add('http://localhost:19006');
  }
  return origins;
}

/** Fail closed before reading an upload or choosing a paid provider. */
export function guardBackgroundRemovalRequest(
  req: any,
  env: Record<string, string | undefined> = process.env,
): void {
  const isProduction = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  if (isProduction && env.BACKGROUND_REMOVAL_API_ENABLED !== '1') {
    throw new HttpError(
      'Smart isolate is temporarily unavailable.',
      503,
      'background_removal_disabled',
    );
  }

  // Parse the complete configured list even for native calls so a malformed
  // production configuration cannot be silently ignored.
  const allowedOrigins = allowedBackgroundRemovalOrigins(env);
  if (isProduction && allowedOrigins.size === 0) throw configurationError();
  const suppliedOrigin = headerValue(req.headers?.origin).trim();
  if (isProduction && !suppliedOrigin) {
    throw new HttpError(
      'A verified PixBrik browser origin is required.',
      403,
      'background_removal_origin_required',
    );
  }
  if (suppliedOrigin) {
    const origin = canonicalOrigin(suppliedOrigin);
    if (!origin || !allowedOrigins.has(origin)) {
      throw new HttpError(
        'This smart-isolate origin is not allowed.',
        403,
        'background_removal_origin_denied',
      );
    }
  }
}

function requestIp(req: any): string {
  return (
    headerValue(req.headers?.['x-forwarded-for']).split(',')[0]?.trim() ||
    headerValue(req.headers?.['x-real-ip']).trim() ||
    String(req.socket?.remoteAddress ?? '') ||
    'unknown'
  );
}

/** Hash the network identifier so the warm-function map never stores raw IPs. */
export function backgroundRemovalRateKey(req: any): string {
  return createHash('sha256').update(requestIp(req) || 'unknown').digest('hex').slice(0, 24);
}

function nextBucket(
  current: RateBucket | null | undefined,
  limit: number,
  now: number,
  resetAt: number,
  code: string,
): RateBucket {
  if (!current || current.resetAt <= now) return { count: 1, resetAt };
  if (current.count >= limit) {
    throw new HttpError(
      'Smart isolate has reached a safety limit. Please try again later.',
      429,
      code,
      Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    );
  }
  return { count: current.count + 1, resetAt: current.resetAt };
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** Consume local per-IP and all-provider budgets immediately before selection. */
export function consumeBackgroundRemovalQuota(
  req: any,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): void {
  const ipLimit = configuredPositiveInteger(
    env.BACKGROUND_REMOVAL_IP_HOURLY_LIMIT,
    DEFAULT_BACKGROUND_REMOVAL_IP_HOURLY_LIMIT,
    10_000,
  );
  const dailyLimit = configuredPositiveInteger(
    env.BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT,
    DEFAULT_BACKGROUND_REMOVAL_DAILY_LIMIT,
    1_000_000,
  );

  if (ipRateBuckets.size > 4_096) {
    for (const [key, bucket] of ipRateBuckets) {
      if (bucket.resetAt <= now) ipRateBuckets.delete(key);
    }
    if (ipRateBuckets.size > 4_096) {
      ipRateBuckets.delete(ipRateBuckets.keys().next().value as string);
    }
  }

  const key = backgroundRemovalRateKey(req);
  // Calculate both results before committing either one, so a rejected global
  // budget check does not also consume the caller's per-IP allowance.
  const nextIp = nextBucket(
    ipRateBuckets.get(key),
    ipLimit,
    now,
    now + BACKGROUND_REMOVAL_RATE_WINDOW_MS,
    'background_removal_rate_limited',
  );
  const nextDaily = nextBucket(
    dailyProviderBucket,
    dailyLimit,
    now,
    nextUtcMidnight(now),
    'background_removal_daily_limit',
  );
  ipRateBuckets.set(key, nextIp);
  dailyProviderBucket = nextDaily;
}

export function clearBackgroundRemovalSecurityForTests(): void {
  ipRateBuckets.clear();
  dailyProviderBucket = null;
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
    throw configurationError();
  }

  const preferred = requested as BackgroundRemovalProvider | undefined;
  const order: BackgroundRemovalProvider[] = preferred
    ? [preferred, preferred === 'photoroom' ? 'removebg' : 'photoroom']
    : ['photoroom', 'removebg'];

  for (const provider of order) {
    const key = configuredKey(provider, env);
    if (key) return { key, provider };
  }
  throw configurationError();
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
    throw new HttpError('The cropped image is too large.', 413, 'background_removal_too_large');
  }

  const readyBody = req.body;
  if (Buffer.isBuffer(readyBody)) {
    if (readyBody.length > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413, 'background_removal_too_large');
    }
    return readyBody;
  }
  if (typeof readyBody === 'string' || readyBody instanceof Uint8Array) {
    const buffer = Buffer.from(readyBody);
    if (buffer.length > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413, 'background_removal_too_large');
    }
    return buffer;
  }

  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    throw new HttpError('Expected a multipart PNG upload.', 400, 'invalid_background_removal_request');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BACKGROUND_INPUT_BYTES) {
      throw new HttpError('The cropped image is too large.', 413, 'background_removal_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function multipartBoundary(contentType: string): string {
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError('Expected a multipart PNG upload.', 415, 'background_removal_media_type');
  }
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw new HttpError('The multipart boundary is invalid.', 400, 'invalid_background_removal_request');
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
      throw new HttpError('The multipart upload is malformed.', 400, 'invalid_background_removal_request');
    }
    headerStart += 2;
    const headerEnd = body.indexOf(headerBreak, headerStart);
    if (headerEnd === -1) {
      throw new HttpError('The multipart upload is malformed.', 400, 'invalid_background_removal_request');
    }
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + headerBreak.length;
    const dataEnd = body.indexOf(nextMarker, dataStart);
    if (dataEnd === -1) {
      throw new HttpError('The multipart upload is malformed.', 400, 'invalid_background_removal_request');
    }

    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? '';
    const name = disposition.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    if (name === 'image') {
      const partType = headers.match(/content-type:\s*([^;\r\n]+)/i)?.[1]?.trim().toLowerCase();
      if (partType !== 'image/png') {
        throw new HttpError('The cropped image must be a PNG.', 415, 'background_removal_media_type');
      }
      return body.subarray(dataStart, dataEnd);
    }
    // `dataEnd` points at the CRLF immediately before the next marker.
    markerIndex = dataEnd + 2;
  }

  throw new HttpError('Multipart field `image` is required.', 400, 'invalid_background_removal_request');
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Validate encoded size and the dimensions in the PNG IHDR. */
export function validatePngInput(png: Buffer): { height: number; width: number } {
  if (png.length > MAX_BACKGROUND_INPUT_BYTES) {
    throw new HttpError('The cropped image is too large.', 413, 'background_removal_too_large');
  }
  if (
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new HttpError('The uploaded file is not a valid PNG.', 415, 'background_removal_media_type');
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
    throw new HttpError(
      'The cropped image must be at most 1024 pixels on its longest edge.',
      413,
      'background_removal_too_large',
    );
  }
  return { height, width };
}

function sendJson(res: any, status: number, code: string, error: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json({ code, error });
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, 'method_not_allowed', 'Use POST.');
    return;
  }

  try {
    guardBackgroundRemovalRequest(req);
    const body = await readRequestBody(req);
    const png = extractMultipartPng(body, headerValue(req.headers?.['content-type']));
    validatePngInput(png);

    // Every cheap request and image guard has passed. Only now may we consume
    // budget, inspect provider credentials, or construct a paid provider call.
    consumeBackgroundRemovalQuota(req);
    const { key, provider } = selectBackgroundRemovalProvider();
    const subjectHint = headerValue(req.headers?.['x-pixbrik-subject-hint']);
    const settings = providerRequestSettings(provider, subjectHint);
    const form = new FormData();
    // Copy into an ArrayBuffer-backed view. Node's Buffer may be typed over a
    // SharedArrayBuffer, which is not a valid DOM BlobPart in strict builds.
    const imageBytes = new Uint8Array(png.byteLength);
    imageBytes.set(png);
    form.append('image_file', new Blob([imageBytes], { type: 'image/png' }), 'crop.png');
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
        const busy = upstream.status === 429;
        throw new HttpError(
          busy
            ? 'Smart isolate is busy. Please try again shortly.'
            : 'The background-removal service could not process this image.',
          busy ? 429 : 502,
          busy ? 'background_removal_busy' : 'background_removal_provider_failed',
        );
      }

      // Keep the abort signal alive until the complete PNG body has arrived.
      const result = Buffer.from(await upstream.arrayBuffer());
      if (
        result.length < PNG_SIGNATURE.length ||
        !result.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      ) {
        throw new HttpError(
          'The background-removal service returned an invalid image.',
          502,
          'background_removal_provider_failed',
        );
      }

      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(result);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
      sendJson(res, error.status, error.code, error.message);
      return;
    }
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      sendJson(
        res,
        504,
        'background_removal_timeout',
        'Smart isolate timed out. Please try again.',
      );
      return;
    }
    sendJson(res, 500, 'background_removal_failed', 'Smart isolate failed unexpectedly.');
  }
}
