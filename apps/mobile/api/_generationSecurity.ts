/**
 * Defense in depth for endpoints that can spend paid 3D-provider credits.
 *
 * Production must additionally apply a distributed Vercel Firewall limit to
 * /api/meshy/submit and /api/tripo/submit. Serverless memory is deliberately
 * treated only as a fast local circuit breaker, never as the sole quota store.
 */

import { createHash } from 'node:crypto';

export const GENERATION_WINDOW_MS = 60 * 60 * 1_000;
export const DEFAULT_GENERATION_IP_LIMIT = 6;
export const DEFAULT_GENERATION_DAILY_LIMIT = 100;

interface Bucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, Bucket>();
let dailyBucket: Bucket | null = null;

export class GenerationSecurityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = 'GenerationSecurityError';
  }
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeOrigin(value: string): string | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedGenerationOrigins(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const values = [
    'https://pixbrik.com',
    'https://www.pixbrik.com',
    ...(env.GENERATION_ALLOWED_ORIGINS?.split(',') ?? []),
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

function requestIp(req: any): string {
  return (
    headerValue(req.headers?.['x-forwarded-for']).split(',')[0]?.trim() ||
    headerValue(req.headers?.['x-real-ip']).trim() ||
    String(req.socket?.remoteAddress ?? '')
  );
}

function consume(bucket: Bucket | undefined | null, limit: number, now: number, windowMs: number): Bucket {
  if (!bucket || bucket.resetAt <= now) return { count: 1, resetAt: now + windowMs };
  if (bucket.count >= limit) {
    throw new GenerationSecurityError(
      'The 3D generation limit has been reached. Please try again later.',
      429,
      'generation_rate_limited',
      Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    );
  }
  bucket.count += 1;
  return bucket;
}

/** Validate and consume local safety quotas immediately before a paid call. */
export function guardPaidGeneration(
  req: any,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): void {
  if (env.NODE_ENV === 'production' && env.GENERATION_API_ENABLED !== '1') {
    throw new GenerationSecurityError(
      '3D generation is temporarily unavailable.',
      503,
      'generation_disabled',
    );
  }

  const origin = headerValue(req.headers?.origin).trim();
  if (env.NODE_ENV === 'production' && !origin) {
    throw new GenerationSecurityError(
      'A verified PixBrik browser origin is required.',
      403,
      'generation_origin_required',
    );
  }
  if (origin && !allowedGenerationOrigins(env).has(origin)) {
    throw new GenerationSecurityError('This generation origin is not allowed.', 403, 'generation_origin_denied');
  }
  const contentType = headerValue(req.headers?.['content-type']).toLowerCase();
  if (contentType && !contentType.startsWith('application/json')) {
    throw new GenerationSecurityError('Generation requests must use JSON.', 415, 'generation_media_type');
  }

  const ip = requestIp(req);
  if (ip) {
    const key = createHash('sha256').update(ip).digest('hex').slice(0, 24);
    const limit = positiveInteger(env.GENERATION_IP_HOURLY_LIMIT, DEFAULT_GENERATION_IP_LIMIT);
    ipBuckets.set(key, consume(ipBuckets.get(key), limit, now, GENERATION_WINDOW_MS));
  }

  const dailyLimit = positiveInteger(env.GENERATION_DAILY_TASK_LIMIT, DEFAULT_GENERATION_DAILY_LIMIT);
  dailyBucket = consume(dailyBucket, dailyLimit, now, 24 * 60 * 60 * 1_000);
}

export function sendGenerationSecurityError(res: any, error: GenerationSecurityError): void {
  res.setHeader?.('Cache-Control', 'no-store');
  if (error.retryAfterSeconds) res.setHeader?.('Retry-After', String(error.retryAfterSeconds));
  res.status(error.status).json({ code: error.code, error: error.message });
}

export function clearGenerationSecurityForTests(): void {
  ipBuckets.clear();
  dailyBucket = null;
}
