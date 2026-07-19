import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Principal } from "@/lib/auth";
import { readEnv } from "@/lib/env";

const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 30 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type LibraryStudioClaims = Readonly<{
  exp: number;
  iat: number;
  nonce: string;
  sub: string;
  v: 1;
}>;

function signingSecret(source: NodeJS.ProcessEnv = process.env): string | null {
  const secret = readEnv("PIXBRIK_BACKEND_SHARED_SECRET", source);
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function parseClaims(encoded: string): LibraryStudioClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<LibraryStudioClaims>;
    if (
      parsed.v !== SESSION_VERSION
      || typeof parsed.sub !== "string"
      || !UUID_PATTERN.test(parsed.sub)
      || typeof parsed.iat !== "number"
      || !Number.isSafeInteger(parsed.iat)
      || typeof parsed.exp !== "number"
      || !Number.isSafeInteger(parsed.exp)
      || typeof parsed.nonce !== "string"
      || !/^[A-Za-z0-9_-]{20,64}$/u.test(parsed.nonce)
    ) return null;
    return parsed as LibraryStudioClaims;
  } catch {
    return null;
  }
}

export function createLibraryStudioSession(
  principal: Principal,
  now = Math.floor(Date.now() / 1_000),
  source: NodeJS.ProcessEnv = process.env
): string | null {
  const secret = signingSecret(source);
  if (!secret || !UUID_PATTERN.test(principal.userId)) return null;
  const claims: LibraryStudioClaims = {
    exp: now + SESSION_TTL_SECONDS,
    iat: now,
    nonce: randomBytes(18).toString("base64url"),
    sub: principal.userId,
    v: SESSION_VERSION
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyLibraryStudioSession(
  token: string,
  now = Math.floor(Date.now() / 1_000),
  source: NodeJS.ProcessEnv = process.env
): LibraryStudioClaims | null {
  const secret = signingSecret(source);
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!secret || !payload || !suppliedSignature || extra) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  const expected = signature(payload, secret);
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
  const claims = parseClaims(payload);
  if (!claims || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > SESSION_TTL_SECONDS) {
    return null;
  }
  return claims;
}

export function libraryStudioUrl(principal: Principal, source: NodeJS.ProcessEnv = process.env): string | null {
  const token = createLibraryStudioSession(principal, Math.floor(Date.now() / 1_000), source);
  const configured = readEnv("CUSTOMER_APP_URL", source);
  if (!token || !configured) return null;
  try {
    const target = new URL(configured);
    if (target.protocol !== "https:" || target.username || target.password) return null;
    target.pathname = "/";
    target.search = "";
    target.hash = `lab=1&studio=${token}`;
    return target.toString();
  } catch {
    return null;
  }
}
