import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER_NAME = 'x-pixbrik-studio-session';
const SESSION_TTL_SECONDS = 30 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface StudioSessionClaims {
  exp: number;
  iat: number;
  nonce: string;
  sub: string;
  v: 1;
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

function signingSecret(env: Record<string, string | undefined>): string | null {
  const secret = env.PIXBRIK_BACKEND_SHARED_SECRET?.trim();
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

export function studioSessionToken(req: any): string {
  return headerValue(req.headers?.[HEADER_NAME]).trim();
}

export function verifyStudioSessionToken(
  token: string,
  env: Record<string, string | undefined> = process.env,
  now = Math.floor(Date.now() / 1_000),
): StudioSessionClaims | null {
  const secret = signingSecret(env);
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!secret || !payload || !suppliedSignature || extra) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest();
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<StudioSessionClaims>;
    if (
      claims.v !== 1
      || typeof claims.sub !== 'string'
      || !UUID_PATTERN.test(claims.sub)
      || typeof claims.iat !== 'number'
      || !Number.isSafeInteger(claims.iat)
      || typeof claims.exp !== 'number'
      || !Number.isSafeInteger(claims.exp)
      || typeof claims.nonce !== 'string'
      || !/^[A-Za-z0-9_-]{20,64}$/.test(claims.nonce)
      || claims.iat > now + 30
      || claims.exp <= now
      || claims.exp - claims.iat > SESSION_TTL_SECONDS
    ) return null;
    return claims as StudioSessionClaims;
  } catch {
    return null;
  }
}

export function requireStudioSession(req: any): StudioSessionClaims {
  const claims = verifyStudioSessionToken(studioSessionToken(req));
  if (!claims) {
    const error = new Error('Open Library Studio from the authenticated backoffice to continue.');
    Object.assign(error, { code: 'studio_session_required', status: 403 });
    throw error;
  }
  return claims;
}
