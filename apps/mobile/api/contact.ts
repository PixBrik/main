/**
 * POST /api/contact
 *
 * Validates a public contact request and sends it through Resend. Credentials
 * remain server-side. The honeypot deliberately returns the normal accepted
 * response so automated submitters do not learn how they were detected.
 *
 * The in-process limiter is defense in depth for warm functions. Production
 * LAUNCH BLOCKER: production must enforce a distributed per-IP limit for this
 * path in Vercel Firewall; this warm-instance map is not a security boundary.
 */

import { createHash } from 'node:crypto';

import {
  CONTACT_MAX_BODY_BYTES,
  ContactServiceError,
  ContactValidationError,
  parseContactSubmission,
  sendContactEmail,
} from './_contactEmail';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
export const CONTACT_RATE_LIMIT_MAX = 5;
export const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

function sendJson(res: any, status: number, body: unknown): void {
  res.status(status).json(body);
}

function accepted(res: any, submissionId: string): void {
  sendJson(res, 202, { messageKey: 'contact.received', ok: true, submissionId });
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

export function allowedContactOrigins(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const values = [
    'https://pixbrik.com',
    'https://www.pixbrik.com',
    ...(env.CONTACT_ALLOWED_ORIGINS?.split(',') ?? []),
    env.PIXBRIK_APP_URL ?? '',
    env.VERCEL_URL ?? '',
    env.VERCEL_BRANCH_URL ?? '',
    env.VERCEL_PROJECT_PRODUCTION_URL ?? '',
  ];
  const origins = new Set<string>();
  for (const value of values) {
    const origin = safeOrigin(value.trim());
    if (origin) origins.add(origin);
  }
  if (env.NODE_ENV !== 'production') {
    origins.add('http://localhost:8081');
    origins.add('http://localhost:19006');
  }
  return origins;
}

function requireAllowedOrigin(
  req: any,
  env: Record<string, string | undefined> = process.env,
): void {
  const origin = headerValue(req.headers?.origin).trim();
  if (env.NODE_ENV === 'production' && !origin) {
    throw new HttpError('A verified PixBrik browser origin is required.', 403, 'contact_origin_required');
  }
  if (origin && !allowedContactOrigins(env).has(origin)) {
    throw new HttpError('This contact request origin is not allowed.', 403, 'contact_origin_denied');
  }
}

function requestRateKey(req: any): string {
  const forwarded = headerValue(req.headers?.['x-forwarded-for']).split(',')[0]?.trim();
  const address = forwarded || headerValue(req.headers?.['x-real-ip']).trim() || req.socket?.remoteAddress || 'unknown';
  return createHash('sha256').update(String(address)).digest('hex').slice(0, 24);
}

export function consumeContactRateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  if (rateBuckets.size > 2_048) {
    for (const [candidate, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(candidate);
    }
    if (rateBuckets.size > 2_048) rateBuckets.delete(rateBuckets.keys().next().value as string);
  }

  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + CONTACT_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= CONTACT_RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearContactRateLimitsForTests(): void {
  rateBuckets.clear();
}

function byteLength(value: string | Buffer): number {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
}

async function readBody(req: any): Promise<string> {
  const declared = Number(headerValue(req.headers?.['content-length']));
  if (Number.isFinite(declared) && declared > CONTACT_MAX_BODY_BYTES) {
    throw new HttpError('The contact request is too large.', 413, 'contact_too_large');
  }
  const contentType = headerValue(req.headers?.['content-type']).toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError('The contact request must be JSON.', 415, 'contact_media_type');
  }

  if (req.body !== undefined && req.body !== null) {
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);
    if (byteLength(body) > CONTACT_MAX_BODY_BYTES) {
      throw new HttpError('The contact request is too large.', 413, 'contact_too_large');
    }
    return Buffer.isBuffer(body) ? body.toString('utf8') : body;
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    throw new HttpError('A JSON contact request is required.', 400, 'invalid_contact_request');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > CONTACT_MAX_BODY_BYTES) {
      throw new HttpError('The contact request is too large.', 413, 'contact_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { code: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  try {
    requireAllowedOrigin(req);
    const raw = await readBody(req);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HttpError('The contact request is not valid JSON.', 400, 'invalid_contact_request');
    }
    const submission = parseContactSubmission(value);
    if (submission.trapped) {
      accepted(res, submission.submissionId);
      return;
    }

    const rateLimit = consumeContactRateLimit(requestRateKey(req));
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      throw new HttpError('Please wait before sending another message.', 429, 'contact_rate_limited');
    }

    await sendContactEmail(submission);
    accepted(res, submission.submissionId);
  } catch (error) {
    if (error instanceof ContactValidationError) {
      sendJson(res, 400, { code: error.code, field: error.field, message: error.message });
      return;
    }
    if (error instanceof ContactServiceError || error instanceof HttpError) {
      sendJson(res, error.status, { code: error.code, message: error.message });
      return;
    }
    sendJson(res, 500, { code: 'contact_failed', message: 'Contact failed unexpectedly.' });
  }
}
