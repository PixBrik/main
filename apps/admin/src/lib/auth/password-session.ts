import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { withDatabaseRole } from "@/lib/db";
import { assertSafeAuthEnvironment, authMode } from "@/lib/env";
import type { Permission } from "@/lib/permissions";
import { ADMIN_BASE_PATH } from "@/lib/routes";
import {
  digestSessionToken,
  evaluateStaffPasswordPolicy,
  generateOpaqueSessionToken,
  generateTemporaryPassword,
  hashStaffPassword,
  prepareDummyPasswordVerification,
  performDummyPasswordVerification,
  rehashVerifiedStaffPassword,
  verifyStaffPasswordDetailed,
  verifyStaffPassword
} from "@/lib/auth/password";
import type { AuthRequestContext } from "@/lib/auth/request-security";
import type { Principal } from "@/lib/auth/types";

const PRODUCTION_SESSION_COOKIE = "__Host-pixbrik_admin_session";
const LEGACY_PRODUCTION_SESSION_COOKIE = "__Secure-pixbrik_admin_session";
const DEVELOPMENT_SESSION_COOKIE = "pixbrik_admin_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1_000;

type CredentialRow = {
  user_id: string;
  email: string;
  password_hash: string;
  password_pepper_version: number;
  password_version: string | number | bigint;
  credential_status: string;
  must_change_password: boolean;
  temporary_password_expires_at: Date | string | null;
  failed_login_count: number;
  locked_until: Date | string | null;
  user_status: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  must_change_password: boolean;
  roles?: string[] | null;
  permissions?: string[] | null;
  reauthenticated_at?: Date | string | null;
  expires_at: Date | string;
};

type CurrentPasswordRow = {
  user_id: string;
  password_hash: string;
  password_pepper_version: number;
  password_version: string | number | bigint;
};

type StaffUserRow = {
  user_id: string;
  email: string;
  display_name: string | null;
  user_status: StaffUserStatus;
  credential_status: StaffCredentialStatus | null;
  must_change_password: boolean | null;
  temporary_password_expires_at: Date | string | null;
  failed_login_count: number | null;
  locked_until: Date | string | null;
  last_signed_in_at: Date | string | null;
  password_version: string | number | bigint;
  is_primary_owner: boolean;
  roles: string[] | null;
  active_session_count: number | string | bigint;
};

export type StaffUserStatus = "invited" | "active" | "suspended" | "deleted";
export type StaffCredentialStatus = "pending" | "active" | "retired";

export type StaffUser = Readonly<{
  userId: string;
  email: string;
  displayName?: string;
  status: StaffUserStatus;
  credentialStatus?: StaffCredentialStatus;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt?: Date;
  failedLoginCount: number;
  lockedUntil?: Date;
  lastSignedInAt?: Date;
  passwordVersion: string;
  isPrimaryOwner: boolean;
  roles: readonly string[];
  activeSessionCount: number;
}>;

export const STAFF_ROLES = [
  "owner",
  "operations",
  "production",
  "support",
  "finance",
  "marketing",
  "analyst"
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export class LocalAuthError extends Error {
  readonly code:
    | "invalid_credentials"
    | "invalid_input"
    | "password_policy"
    | "password_reused"
    | "session_required"
    | "recent_auth_required"
    | "operation_failed";

  constructor(code: LocalAuthError["code"], message: string) {
    super(message);
    this.name = "LocalAuthError";
    this.code = code;
  }
}

function sessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_SESSION_COOKIE
    : DEVELOPMENT_SESSION_COOKIE;
}

function sessionCookiePath(): string {
  return process.env.NODE_ENV === "production" ? "/" : ADMIN_BASE_PATH;
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asPositiveBigInt(value: string | number | bigint): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 1n) throw new Error("Invalid password version returned by the identity store");
  return parsed;
}

function asNonNegativeBigInt(value: string | number | bigint): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n) throw new Error("Invalid password version returned by the identity store");
  return parsed;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function databaseConstraintName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { constraint_name?: unknown; constraint?: unknown };
  const value = record.constraint_name ?? record.constraint;
  return typeof value === "string" ? value : undefined;
}

function isSignInRejection(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code === "28000"
    || code === "40001"
    || (
      code === "23505"
      && databaseConstraintName(error) === "audit_event_local_auth_request_once"
    );
}

function assertPasswordMode(): void {
  assertSafeAuthEnvironment();
  if (authMode() !== "password") throw new LocalAuthError("operation_failed", "Password authentication is unavailable");
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length < 3
    || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new LocalAuthError("invalid_input", "Enter a valid email address");
  }
  return email;
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim().replace(/\s+/gu, " ");
  if (Array.from(displayName).length < 2 || Array.from(displayName).length > 100) {
    throw new LocalAuthError("invalid_input", "Name must contain between 2 and 100 characters");
  }
  return displayName;
}

function normalizeReason(value: string): string {
  const reason = value.trim().replace(/\s+/gu, " ");
  if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
    throw new LocalAuthError("invalid_input", "Add a brief reason between 5 and 500 characters");
  }
  return reason;
}

function normalizeRoles(values: readonly string[]): StaffRole[] {
  const roles = [...new Set(values.map((value) => value.trim()))];
  if (roles.length < 1 || roles.some((role) => !STAFF_ROLES.includes(role as StaffRole))) {
    throw new LocalAuthError("invalid_input", "Select at least one valid staff role");
  }
  return roles as StaffRole[];
}

async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(sessionCookieName())?.value ?? null;
}

async function requireSessionDigest(): Promise<string> {
  const token = await readSessionToken();
  if (!token) throw new LocalAuthError("session_required", "Sign in again to continue");
  try {
    return digestSessionToken(token).digest;
  } catch {
    throw new LocalAuthError("session_required", "Sign in again to continue");
  }
}

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const now = Date.now();
  const maximumExpiry = now + SESSION_MAX_AGE_SECONDS * 1_000;
  if (expiresAt.getTime() <= now || expiresAt.getTime() > maximumExpiry + 60_000) {
    throw new Error("Identity store returned an invalid session expiry");
  }

  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: sessionCookiePath(),
    expires: expiresAt,
    priority: "high"
  });
}

export async function clearPasswordSessionCookie(): Promise<void> {
  const store = await cookies();
  const cookiesToClear = [
    { name: PRODUCTION_SESSION_COOKIE, path: "/", secure: true },
    { name: LEGACY_PRODUCTION_SESSION_COOKIE, path: ADMIN_BASE_PATH, secure: true },
    { name: DEVELOPMENT_SESSION_COOKIE, path: ADMIN_BASE_PATH, secure: false }
  ] as const;
  for (const cookie of cookiesToClear) {
    store.set(cookie.name, "", {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: "strict",
      path: cookie.path,
      maxAge: 0,
      priority: "high"
    });
  }
}

async function checkIpThrottle(context: AuthRequestContext): Promise<boolean> {
  const rows = await withDatabaseRole("identity", (sql) => sql<{
    failed_login_count: number;
    locked_until: Date | string | null;
  }[]>`
    SELECT * FROM pixbrik.local_auth_check_throttle(${context.ipDigest})
  `);
  const lockedUntil = asDate(rows[0]?.locked_until);
  return lockedUntil !== undefined && lockedUntil > new Date();
}

async function recordCredentialFailure(
  credential: CredentialRow | null,
  context: AuthRequestContext
): Promise<void> {
  try {
    await withDatabaseRole("identity", (sql) => sql`
      SELECT *
      FROM pixbrik.local_auth_record_failure(
        ${credential?.user_id ?? null}::uuid,
        ${credential ? asPositiveBigInt(credential.password_version).toString() : "0"}::bigint,
        ${context.requestId}::uuid,
        ${context.ipDigest},
        ${context.userAgentDigest}
      )
    `);
  } catch (error) {
    if (isSignInRejection(error)) {
      throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
    }
    throw error;
  }
}

export async function signInWithPassword(
  suppliedEmail: string,
  suppliedPassword: string,
  context: AuthRequestContext
): Promise<{ mustChangePassword: boolean }> {
  assertPasswordMode();
  if (await checkIpThrottle(context)) {
    throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
  }
  // Generate the per-instance dummy hash before branching on credential
  // existence so the first unknown login does not have a distinguishable
  // cold-start cost. This runs for every non-throttled attempt.
  await prepareDummyPasswordVerification();
  let email: string;
  try {
    email = normalizeEmail(suppliedEmail);
  } catch {
    await performDummyPasswordVerification(suppliedPassword);
    await recordCredentialFailure(null, context);
    throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
  }

  const rows = await withDatabaseRole("identity", (sql) => sql<CredentialRow[]>`
    SELECT * FROM pixbrik.local_auth_lookup_credential(${email})
  `);
  const credential = rows[0];

  if (!credential) {
    await performDummyPasswordVerification(suppliedPassword);
    await recordCredentialFailure(null, context);
    throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
  }

  const now = new Date();
  const lockedUntil = asDate(credential.locked_until);
  const temporaryExpiry = asDate(credential.temporary_password_expires_at);
  const accountCanSignIn = credential.user_status === "active"
    && credential.credential_status === "active"
    && (!lockedUntil || lockedUntil <= now)
    && (!credential.must_change_password || (temporaryExpiry !== undefined && temporaryExpiry > now));

  const passwordVerification = await verifyStaffPasswordDetailed(
    suppliedPassword,
    credential.password_hash,
    credential.password_pepper_version
  );

  if (!accountCanSignIn || !passwordVerification.matches) {
    await recordCredentialFailure(passwordVerification.matches ? null : credential, context);
    throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
  }

  const token = generateOpaqueSessionToken();
  const tokenDigest = digestSessionToken(token);
  let session: SessionRow | undefined;
  try {
    const expectedPasswordVersion = asPositiveBigInt(credential.password_version);
    const upgraded = passwordVerification.needsRehash
      ? await rehashVerifiedStaffPassword(suppliedPassword)
      : undefined;
    const sessions = await withDatabaseRole("identity", async (sql) => {
      let sessionPasswordVersion = expectedPasswordVersion;
      if (upgraded) {
        const upgradeRows = await sql<{ password_version: string | number | bigint }[]>`
          SELECT *
          FROM pixbrik.local_auth_upgrade_password_pepper(
            ${credential.user_id}::uuid,
            ${expectedPasswordVersion.toString()}::bigint,
            ${upgraded.hash},
            ${upgraded.pepperVersion},
            ${randomUUID()}::uuid
          )
        `;
        if (!upgradeRows[0]) {
          throw Object.assign(new Error("Password credential changed concurrently"), { code: "40001" });
        }
        sessionPasswordVersion = asPositiveBigInt(upgradeRows[0].password_version);
        if (sessionPasswordVersion !== expectedPasswordVersion + 1n) {
          throw Object.assign(new Error("Password credential changed concurrently"), { code: "40001" });
        }
      }

      return sql<SessionRow[]>`
        SELECT *
        FROM pixbrik.local_auth_create_session(
          ${credential.user_id}::uuid,
          ${sessionPasswordVersion.toString()}::bigint,
          ${tokenDigest.digest},
          ${tokenDigest.keyVersion},
          ${context.requestId}::uuid,
          ${context.ipDigest},
          ${context.userAgentDigest}
        )
      `;
    });
    session = sessions[0];
  } catch (error) {
    if (isSignInRejection(error)) {
      throw new LocalAuthError("invalid_credentials", "Email or password is incorrect");
    }
    throw error;
  }

  const expiresAt = asDate(session?.expires_at);
  if (!session || !expiresAt) throw new LocalAuthError("operation_failed", "Sign-in could not be completed");
  await setSessionCookie(token, expiresAt);
  return { mustChangePassword: session.must_change_password };
}

export async function resolvePasswordPrincipal(): Promise<Principal | null> {
  assertPasswordMode();
  let digest: string;
  try {
    digest = await requireSessionDigest();
  } catch (error) {
    if (error instanceof LocalAuthError && error.code === "session_required") return null;
    throw error;
  }

  const rows = await withDatabaseRole("identity", (sql) => sql<SessionRow[]>`
    SELECT * FROM pixbrik.local_auth_resolve_session(${digest}, ${true})
  `);
  const row = rows[0];
  if (!row) return null;

  return {
    provider: "password",
    subject: `password:${row.user_id}`,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    status: "active",
    roles: row.roles ?? [],
    permissions: (row.permissions ?? []) as Permission[],
    mustChangePassword: row.must_change_password,
    reauthenticatedAt: asDate(row.reauthenticated_at)
  };
}

async function recordReauthenticationFailure(
  digest: string,
  context: AuthRequestContext
): Promise<void> {
  let rows: { failed_count: number; session_revoked: boolean }[];
  try {
    rows = await withDatabaseRole("identity", (sql) => sql<{
      failed_count: number;
      session_revoked: boolean;
    }[]>`
      SELECT *
      FROM pixbrik.local_auth_record_reauth_failure(
        ${digest},
        ${context.requestId}::uuid
      )
    `);
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code !== "28000" && code !== "40001") throw error;
    rows = [];
  }

  if (!rows[0] || rows[0].session_revoked) {
    await clearPasswordSessionCookie();
    throw new LocalAuthError("session_required", "Too many failed attempts. Sign in again to continue");
  }
}

async function readAndVerifyCurrentPassword(
  currentPassword: string,
  context: AuthRequestContext
): Promise<{ digest: string; row: CurrentPasswordRow }> {
  const digest = await requireSessionDigest();
  const rows = await withDatabaseRole("identity", (sql) => sql<CurrentPasswordRow[]>`
    SELECT * FROM pixbrik.local_auth_read_current_password(${digest})
  `);
  const row = rows[0];
  if (!row) {
    await performDummyPasswordVerification(currentPassword);
    throw new LocalAuthError("session_required", "Sign in again to continue");
  }
  const verified = await verifyStaffPassword(
    currentPassword,
    row.password_hash,
    row.password_pepper_version
  );
  if (!verified) {
    await recordReauthenticationFailure(digest, context);
    throw new LocalAuthError("invalid_credentials", "Your current password is incorrect");
  }
  return { digest, row };
}

export async function markCurrentSessionReauthenticated(
  currentPassword: string,
  context: AuthRequestContext
): Promise<Date> {
  assertPasswordMode();
  const { digest, row } = await readAndVerifyCurrentPassword(currentPassword, context);
  const result = await withDatabaseRole("identity", (sql) => sql<{ reauthenticated_at: Date | string }[]>`
    SELECT *
    FROM pixbrik.local_auth_mark_reauthenticated(
      ${digest},
      ${asPositiveBigInt(row.password_version).toString()}::bigint,
      ${context.requestId}::uuid
    )
  `);
  const reauthenticatedAt = asDate(result[0]?.reauthenticated_at);
  if (!reauthenticatedAt) throw new LocalAuthError("operation_failed", "Password confirmation failed");
  return reauthenticatedAt;
}

export async function changeCurrentPassword(
  currentPassword: string,
  newPassword: string,
  context: AuthRequestContext
): Promise<void> {
  assertPasswordMode();
  const policy = evaluateStaffPasswordPolicy(newPassword);
  if (!policy.valid) {
    throw new LocalAuthError("password_policy", "Use 15–128 characters and avoid common passwords");
  }

  const { digest, row } = await readAndVerifyCurrentPassword(currentPassword, context);
  if (await verifyStaffPassword(newPassword, row.password_hash, row.password_pepper_version)) {
    throw new LocalAuthError("password_reused", "Choose a password you are not already using");
  }

  const encoded = await hashStaffPassword(newPassword);
  const newToken = generateOpaqueSessionToken();
  const newDigest = digestSessionToken(newToken);
  const sessions = await withDatabaseRole("identity", (sql) => sql<SessionRow[]>`
    SELECT *
    FROM pixbrik.local_auth_change_password(
      ${digest},
      ${asPositiveBigInt(row.password_version).toString()}::bigint,
      ${encoded.hash},
      ${encoded.pepperVersion},
      ${newDigest.digest},
      ${newDigest.keyVersion},
      ${context.requestId}::uuid
    )
  `);
  const expiresAt = asDate(sessions[0]?.expires_at);
  if (!expiresAt) throw new LocalAuthError("operation_failed", "Password change could not be completed");
  await setSessionCookie(newToken, expiresAt);
}

export async function logoutPasswordSession(requestId: string): Promise<void> {
  let digest: string | null = null;
  try {
    digest = await requireSessionDigest();
  } catch {
    // Clearing a stale or malformed cookie is still a successful logout.
  }
  if (digest) {
    try {
      await withDatabaseRole("identity", (sql) => sql`
        SELECT pixbrik.local_auth_logout(${digest}, ${requestId}::uuid)
      `);
    } catch {
      // Local cookie removal is intentionally not blocked by an unavailable DB.
    }
  }
  await clearPasswordSessionCookie();
}

export function hasRecentPasswordConfirmation(principal: Principal): boolean {
  return principal.reauthenticatedAt !== undefined
    && Date.now() - principal.reauthenticatedAt.getTime() <= RECENT_AUTH_WINDOW_MS;
}

export async function listStaffUsers(): Promise<StaffUser[]> {
  assertPasswordMode();
  const digest = await requireSessionDigest();
  const rows = await withDatabaseRole("identity", (sql) => sql<StaffUserRow[]>`
    SELECT * FROM pixbrik.local_staff_list(${digest})
  `);
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    status: row.user_status,
    credentialStatus: row.credential_status ?? undefined,
    mustChangePassword: row.must_change_password ?? false,
    temporaryPasswordExpiresAt: asDate(row.temporary_password_expires_at),
    failedLoginCount: row.failed_login_count ?? 0,
    lockedUntil: asDate(row.locked_until),
    lastSignedInAt: asDate(row.last_signed_in_at),
    passwordVersion: asNonNegativeBigInt(row.password_version).toString(),
    isPrimaryOwner: row.is_primary_owner,
    roles: row.roles ?? [],
    activeSessionCount: Number(row.active_session_count)
  }));
}

export async function createStaffUser(
  emailValue: string,
  displayNameValue: string,
  roleValues: readonly string[],
  context: AuthRequestContext
): Promise<{ temporaryPassword: string; expiresAt: Date }> {
  const digest = await requireSessionDigest();
  const email = normalizeEmail(emailValue);
  const displayName = normalizeDisplayName(displayNameValue);
  const roles = normalizeRoles(roleValues);
  const temporaryPassword = generateTemporaryPassword();
  const encoded = await hashStaffPassword(temporaryPassword);
  const rows = await withDatabaseRole("identity", (sql) => sql<{ temporary_password_expires_at: Date | string }[]>`
    SELECT *
    FROM pixbrik.local_staff_create(
      ${digest},
      ${email},
      ${displayName},
      ${encoded.hash},
      ${encoded.pepperVersion},
      ${roles},
      ${context.requestId}::uuid
    )
  `);
  const expiresAt = asDate(rows[0]?.temporary_password_expires_at);
  if (!expiresAt) throw new LocalAuthError("operation_failed", "The staff account could not be created");
  return { temporaryPassword, expiresAt };
}

export async function resetStaffPassword(
  targetUserId: string,
  expectedPasswordVersion: string | number | bigint,
  context: AuthRequestContext
): Promise<{ temporaryPassword: string; expiresAt: Date }> {
  const digest = await requireSessionDigest();
  const passwordVersion = asNonNegativeBigInt(expectedPasswordVersion).toString();
  const temporaryPassword = generateTemporaryPassword();
  const encoded = await hashStaffPassword(temporaryPassword);
  let rows: { temporary_password_expires_at: Date | string }[];
  try {
    rows = await withDatabaseRole("identity", (sql) => sql<{
      temporary_password_expires_at: Date | string;
    }[]>`
      SELECT *
      FROM pixbrik.local_staff_reset_password(
        ${digest},
        ${targetUserId}::uuid,
        ${passwordVersion}::bigint,
        ${encoded.hash},
        ${encoded.pepperVersion},
        ${context.requestId}::uuid
      )
    `);
  } catch (error) {
    if (databaseErrorCode(error) === "40001") {
      throw new LocalAuthError(
        "operation_failed",
        "Password changed in another session. Refresh and try again."
      );
    }
    throw error;
  }
  const expiresAt = asDate(rows[0]?.temporary_password_expires_at);
  if (!expiresAt) throw new LocalAuthError("operation_failed", "The password could not be reset");
  return { temporaryPassword, expiresAt };
}

export async function suspendStaffUser(
  targetUserId: string,
  reasonValue: string,
  context: AuthRequestContext
): Promise<void> {
  const digest = await requireSessionDigest();
  const reason = normalizeReason(reasonValue);
  await withDatabaseRole("identity", (sql) => sql`
    SELECT pixbrik.local_staff_suspend(
      ${digest}, ${targetUserId}::uuid, ${reason}, ${context.requestId}::uuid
    )
  `);
}

export async function restoreStaffUser(
  targetUserId: string,
  context: AuthRequestContext
): Promise<void> {
  const digest = await requireSessionDigest();
  await withDatabaseRole("identity", (sql) => sql`
    SELECT pixbrik.local_staff_restore(
      ${digest}, ${targetUserId}::uuid, ${context.requestId}::uuid
    )
  `);
}

export async function removeStaffUserAccess(
  targetUserId: string,
  reasonValue: string,
  context: AuthRequestContext
): Promise<void> {
  const digest = await requireSessionDigest();
  const reason = normalizeReason(reasonValue);
  await withDatabaseRole("identity", (sql) => sql`
    SELECT pixbrik.local_staff_soft_remove(
      ${digest}, ${targetUserId}::uuid, ${reason}, ${context.requestId}::uuid
    )
  `);
}

export async function setStaffUserRoles(
  targetUserId: string,
  roleValues: readonly string[],
  context: AuthRequestContext
): Promise<readonly string[]> {
  const digest = await requireSessionDigest();
  const roles = normalizeRoles(roleValues);
  const rows = await withDatabaseRole("identity", (sql) => sql<{ roles: string[] }[]>`
    SELECT *
    FROM pixbrik.local_staff_set_roles(
      ${digest}, ${targetUserId}::uuid, ${roles}, ${context.requestId}::uuid
    )
  `);
  if (!rows[0]) throw new LocalAuthError("operation_failed", "The role assignment could not be updated");
  return rows[0].roles;
}
