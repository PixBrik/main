/**
 * Node-only authentication primitives.
 *
 * Do not import this module from a Client Component. `node:crypto` and the
 * native Argon2 binding intentionally keep password and token material on the
 * server. We omit the `server-only` marker package here so the repository's
 * direct Node test runner can import this module.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  hash as argon2Hash,
  verify as argon2Verify
} from "@node-rs/argon2";
import type { Algorithm, Version } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import {
  adjacencyGraphs as commonAdjacencyGraphs,
  dictionary as commonPasswordDictionary
} from "@zxcvbn-ts/language-common";

export const PASSWORD_PEPPER_ENV = "AUTH_PASSWORD_PEPPER" as const;
export const PASSWORD_PEPPER_PREVIOUS_ENV = "AUTH_PASSWORD_PEPPER_PREVIOUS" as const;
export const SESSION_HMAC_KEY_ENV = "AUTH_SESSION_HMAC_KEY" as const;

export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 128;
export const VERSIONED_SECRET_BYTES = 32;
export const TEMPORARY_PASSWORD_RANDOM_BYTES = 18;
export const SESSION_TOKEN_RANDOM_BYTES = 32;
export const HMAC_DIGEST_BYTES = 32;

export const ARGON2ID_MEMORY_COST_KIB = 65_536;
export const ARGON2ID_TIME_COST = 3;
export const ARGON2ID_PARALLELISM = 1;
export const ARGON2ID_OUTPUT_BYTES = 32;
export const ARGON2ID_VERSION = 19;

export const ARGON2ID_OPTIONS = Object.freeze({
  // @node-rs exposes ambient const enums, which cannot be referenced by name
  // with this project's isolatedModules setting. These are the package's
  // documented numeric values for Algorithm.Argon2id and Version.V0x13.
  algorithm: 2 as Algorithm,
  version: 1 as Version,
  memoryCost: ARGON2ID_MEMORY_COST_KIB,
  timeCost: ARGON2ID_TIME_COST,
  parallelism: ARGON2ID_PARALLELISM,
  outputLen: ARGON2ID_OUTPUT_BYTES
});

export const ARGON2ID_HASH_PREFIX =
  `$argon2id$v=${ARGON2ID_VERSION}$m=${ARGON2ID_MEMORY_COST_KIB},t=${ARGON2ID_TIME_COST},p=${ARGON2ID_PARALLELISM}$`;

export type PasswordPolicyViolation =
  | "too_short"
  | "too_long"
  | "common_password"
  | "control_character";

export type PasswordPolicyResult = Readonly<{
  valid: boolean;
  normalizedPassword: string;
  codePointLength: number;
  violations: readonly PasswordPolicyViolation[];
}>;

export type PasswordHash = Readonly<{
  hash: string;
  pepperVersion: number;
}>;

export type PasswordVerificationResult = Readonly<{
  matches: boolean;
  needsRehash: boolean;
}>;

export type VersionedDigest = Readonly<{
  digest: string;
  keyVersion: number;
}>;

type VersionedSecret = Readonly<{
  version: number;
  key: Buffer;
}>;

const VERSIONED_SECRET_PATTERN = /^v([1-9][0-9]*):([A-Za-z0-9_-]+)$/;
const MAX_SECRET_VERSION = 2_147_483_647;
const MAX_PREVIOUS_PASSWORD_PEPPERS = 4;
const PURPOSE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// This evaluator is bundled into the server and performs no runtime network
// request. Its common-password/diceware dictionaries and keyboard graphs catch
// substitutions, sequences and repetitions that a small hand-written list
// cannot cover. Application-specific terms are treated as user inputs.
const passwordStrengthEvaluator = new ZxcvbnFactory({
  dictionary: commonPasswordDictionary,
  graphs: commonAdjacencyGraphs,
  useLevenshteinDistance: true,
  levenshteinThreshold: 2,
  // JavaScript counts astral code points as two UTF-16 code units.
  maxLength: PASSWORD_MAX_CODE_POINTS * 2
});
const PASSWORD_STRENGTH_USER_INPUTS: (string | number)[] = [
  "pixbrik",
  "fotobrik",
  "admin",
  "administrator",
  "backoffice"
];
const MAX_COMMON_PASSWORD_SCORE = 1;

const DUMMY_PASSWORD = "Dummy verifier only - PixBrik 2026";
const dummyHashes = new Map<string, Promise<string>>();

export class PasswordPolicyError extends Error {
  readonly violations: readonly PasswordPolicyViolation[];

  constructor(violations: readonly PasswordPolicyViolation[]) {
    super("Password does not satisfy the staff password policy");
    this.name = "PasswordPolicyError";
    this.violations = [...violations];
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function commonPasswordFingerprint(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isCommonOrPredictablePassword(value: string): boolean {
  const direct = passwordStrengthEvaluator.check(value, PASSWORD_STRENGTH_USER_INPUTS);
  if (direct.score <= MAX_COMMON_PASSWORD_SCORE) return true;

  // Separators and punctuation must not turn repetitions such as
  // "Password Password!!!" into an acceptable password. Checking this
  // comparison-only fingerprint never changes the bytes that are hashed.
  const fingerprint = commonPasswordFingerprint(value);
  return fingerprint.length > 0
    && fingerprint !== value
    && passwordStrengthEvaluator.check(fingerprint, PASSWORD_STRENGTH_USER_INPUTS).score
      <= MAX_COMMON_PASSWORD_SCORE;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function parseVersionedSecret(
  environmentName: string,
  configured: string | undefined
): VersionedSecret {
  if (!configured) {
    throw new Error(`Missing required server environment variable: ${environmentName}`);
  }
  if (configured !== configured.trim()) {
    throw new Error(`${environmentName} must not contain leading or trailing whitespace`);
  }

  const match = VERSIONED_SECRET_PATTERN.exec(configured);
  if (!match) {
    throw new Error(`${environmentName} must use v<positive integer>:<base64url> format`);
  }

  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1 || version > MAX_SECRET_VERSION) {
    throw new Error(`${environmentName} contains an unsupported key version`);
  }

  const encodedKey = match[2];
  const key = Buffer.from(encodedKey, "base64url");
  if (
    key.byteLength !== VERSIONED_SECRET_BYTES
    || key.toString("base64url") !== encodedKey
  ) {
    throw new Error(
      `${environmentName} must contain a canonical base64url-encoded ${VERSIONED_SECRET_BYTES}-byte key`
    );
  }

  return { version, key };
}

function readVersionedSecret(
  environmentName: typeof PASSWORD_PEPPER_ENV | typeof SESSION_HMAC_KEY_ENV,
  source: NodeJS.ProcessEnv
): VersionedSecret {
  return parseVersionedSecret(environmentName, source[environmentName]);
}

function readPasswordPepper(source: NodeJS.ProcessEnv): VersionedSecret {
  return readVersionedSecret(PASSWORD_PEPPER_ENV, source);
}

function readPasswordPepperKeyring(source: NodeJS.ProcessEnv): Readonly<{
  current: VersionedSecret;
  byVersion: ReadonlyMap<number, VersionedSecret>;
}> {
  const current = readPasswordPepper(source);
  const byVersion = new Map<number, VersionedSecret>([[current.version, current]]);
  const configured = source[PASSWORD_PEPPER_PREVIOUS_ENV];
  if (!configured) return { current, byVersion };
  if (configured !== configured.trim()) {
    throw new Error(`${PASSWORD_PEPPER_PREVIOUS_ENV} must not contain leading or trailing whitespace`);
  }

  const entries = configured.split(",");
  if (
    entries.length > MAX_PREVIOUS_PASSWORD_PEPPERS
    || entries.some((entry) => entry.length === 0)
  ) {
    throw new Error(
      `${PASSWORD_PEPPER_PREVIOUS_ENV} must contain 1-${MAX_PREVIOUS_PASSWORD_PEPPERS} comma-separated keys`
    );
  }

  for (const [index, entry] of entries.entries()) {
    const secret = parseVersionedSecret(
      `${PASSWORD_PEPPER_PREVIOUS_ENV}[${index}]`,
      entry
    );
    if (secret.version >= current.version) {
      throw new Error(`${PASSWORD_PEPPER_PREVIOUS_ENV} versions must be lower than the current pepper version`);
    }
    if (byVersion.has(secret.version)) {
      throw new Error(`${PASSWORD_PEPPER_PREVIOUS_ENV} contains a duplicate key version`);
    }
    if ([...byVersion.values()].some((known) => known.key.equals(secret.key))) {
      throw new Error(`${PASSWORD_PEPPER_PREVIOUS_ENV} must not reuse key material across versions`);
    }
    byVersion.set(secret.version, secret);
  }

  return { current, byVersion };
}

function readSessionHmacKey(source: NodeJS.ProcessEnv): VersionedSecret {
  return readVersionedSecret(SESSION_HMAC_KEY_ENV, source);
}

function hmac(
  secret: VersionedSecret,
  domain: string,
  parts: readonly (string | Uint8Array)[]
): string {
  const digest = createHmac("sha256", secret.key);
  digest.update(`pixbrik-auth:${domain}:v1`, "utf8");
  for (const part of parts) {
    digest.update(Uint8Array.of(0));
    digest.update(part);
  }
  return digest.digest("base64url");
}

function dummyCacheKey(secret: VersionedSecret): string {
  const fingerprint = createHash("sha256").update(secret.key).digest("base64url");
  return `${secret.version}:${fingerprint}`;
}

async function getDummyHash(secret: VersionedSecret): Promise<string> {
  const cacheKey = dummyCacheKey(secret);
  const existing = dummyHashes.get(cacheKey);
  if (existing) return existing;

  const created = argon2Hash(DUMMY_PASSWORD, {
    ...ARGON2ID_OPTIONS,
    secret: secret.key
  });
  dummyHashes.set(cacheKey, created);
  try {
    return await created;
  } catch (error) {
    dummyHashes.delete(cacheKey);
    throw error;
  }
}

export function normalizeStaffPassword(password: string): string {
  return requireString(password, "Password").normalize("NFC");
}

export function evaluateStaffPasswordPolicy(password: string): PasswordPolicyResult {
  const normalizedPassword = normalizeStaffPassword(password);
  const length = codePointLength(normalizedPassword);
  const violations: PasswordPolicyViolation[] = [];

  if (length < PASSWORD_MIN_CODE_POINTS) violations.push("too_short");
  if (length > PASSWORD_MAX_CODE_POINTS) violations.push("too_long");
  if (/[\u0000-\u001f\u007f]/u.test(normalizedPassword)) {
    violations.push("control_character");
  }
  if (
    length <= PASSWORD_MAX_CODE_POINTS
    && isCommonOrPredictablePassword(normalizedPassword)
  ) {
    violations.push("common_password");
  }

  return Object.freeze({
    valid: violations.length === 0,
    normalizedPassword,
    codePointLength: length,
    violations: Object.freeze(violations)
  });
}

async function hashNormalizedPasswordWithCurrentPepper(
  normalizedPassword: string,
  source: NodeJS.ProcessEnv
): Promise<PasswordHash> {
  const pepper = readPasswordPepper(source);
  const hash = await argon2Hash(normalizedPassword, {
    ...ARGON2ID_OPTIONS,
    secret: pepper.key
  });

  if (!hash.startsWith(ARGON2ID_HASH_PREFIX)) {
    throw new Error("Password hashing returned an unexpected Argon2 encoding");
  }
  return { hash, pepperVersion: pepper.version };
}

export async function hashStaffPassword(
  password: string,
  source: NodeJS.ProcessEnv = process.env
): Promise<PasswordHash> {
  const policy = evaluateStaffPasswordPolicy(password);
  if (!policy.valid) throw new PasswordPolicyError(policy.violations);

  return hashNormalizedPasswordWithCurrentPepper(policy.normalizedPassword, source);
}

/**
 * Rehashes a password that has already been authenticated with an older
 * pepper. This intentionally bypasses the current creation policy so a
 * grandfathered credential can be rotated without locking its owner out.
 * Call only after verifyStaffPasswordDetailed(...).matches is true.
 */
export async function rehashVerifiedStaffPassword(
  password: string,
  source: NodeJS.ProcessEnv = process.env
): Promise<PasswordHash> {
  const normalized = normalizeStaffPassword(password);
  if (codePointLength(normalized) > PASSWORD_MAX_CODE_POINTS) {
    throw new PasswordPolicyError(["too_long"]);
  }
  return hashNormalizedPasswordWithCurrentPepper(normalized, source);
}

/**
 * Prepares the process-local dummy Argon2 hash. Authentication callers should
 * await this once on every non-throttled sign-in path before looking up an
 * account, making the one-time cold-start cost independent of account existence.
 */
export async function prepareDummyPasswordVerification(
  source: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const { current } = readPasswordPepperKeyring(source);
  await getDummyHash(current);
}

export async function performDummyPasswordVerification(
  password: string,
  source: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const { current: pepper } = readPasswordPepperKeyring(source);
  const dummyHash = await getDummyHash(pepper);
  const normalized = normalizeStaffPassword(password);
  const candidate = codePointLength(normalized) <= PASSWORD_MAX_CODE_POINTS
    ? normalized
    : DUMMY_PASSWORD;
  await argon2Verify(dummyHash, candidate, { secret: pepper.key });
}

export async function verifyStaffPassword(
  password: string,
  storedHash: string,
  storedPepperVersion: number,
  source: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  return (await verifyStaffPasswordDetailed(
    password,
    storedHash,
    storedPepperVersion,
    source
  )).matches;
}

export async function verifyStaffPasswordDetailed(
  password: string,
  storedHash: string,
  storedPepperVersion: number,
  source: NodeJS.ProcessEnv = process.env
): Promise<PasswordVerificationResult> {
  requireString(storedHash, "Stored password hash");
  const keyring = readPasswordPepperKeyring(source);
  const normalized = normalizeStaffPassword(password);
  const storedPepper = Number.isSafeInteger(storedPepperVersion)
    ? keyring.byVersion.get(storedPepperVersion)
    : undefined;

  if (
    !Number.isSafeInteger(storedPepperVersion)
    || storedPepperVersion < 1
    || !storedPepper
    || !storedHash.startsWith(ARGON2ID_HASH_PREFIX)
    || codePointLength(normalized) > PASSWORD_MAX_CODE_POINTS
  ) {
    await performDummyPasswordVerification(normalized, source);
    return Object.freeze({ matches: false, needsRehash: false });
  }

  try {
    const matches = await argon2Verify(storedHash, normalized, {
      secret: storedPepper.key
    });
    return Object.freeze({
      matches,
      needsRehash: matches && storedPepper.version !== keyring.current.version
    });
  } catch {
    // Malformed or otherwise unverifiable hashes fail closed without exposing
    // native parser details to the authentication caller.
    await performDummyPasswordVerification(normalized, source);
    return Object.freeze({ matches: false, needsRehash: false });
  }
}

export function generateTemporaryPassword(): string {
  // The probability of a random value matching the focused blocklist is
  // negligible, but the loop makes the password-policy guarantee absolute.
  for (;;) {
    const candidate = randomBytes(TEMPORARY_PASSWORD_RANDOM_BYTES).toString("base64url");
    if (evaluateStaffPasswordPolicy(candidate).valid) return candidate;
  }
}

export function generateOpaqueSessionToken(): string {
  return randomBytes(SESSION_TOKEN_RANDOM_BYTES).toString("base64url");
}

export function digestSessionToken(
  token: string,
  source: NodeJS.ProcessEnv = process.env
): VersionedDigest {
  const supplied = requireString(token, "Session token");
  const decoded = Buffer.from(supplied, "base64url");
  if (
    decoded.byteLength !== SESSION_TOKEN_RANDOM_BYTES
    || decoded.toString("base64url") !== supplied
  ) {
    throw new Error("Session token must be a canonical 256-bit base64url value");
  }

  const secret = readSessionHmacKey(source);
  return {
    digest: hmac(secret, "session-token", [decoded]),
    keyVersion: secret.version
  };
}

export function digestPrivateMetadata(
  purpose: string,
  value: string,
  source: NodeJS.ProcessEnv = process.env
): VersionedDigest {
  const domainPurpose = requireString(purpose, "Metadata purpose");
  if (!PURPOSE_PATTERN.test(domainPurpose)) {
    throw new Error("Metadata purpose must be a short lowercase domain label");
  }

  const normalizedValue = requireString(value, "Private metadata").normalize("NFC");
  if (!normalizedValue || codePointLength(normalizedValue) > 4_096) {
    throw new Error("Private metadata must contain between 1 and 4096 code points");
  }

  const secret = readSessionHmacKey(source);
  return {
    digest: hmac(secret, "private-metadata", [domainPurpose, normalizedValue]),
    keyVersion: secret.version
  };
}
