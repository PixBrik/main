import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { withDatabaseRole } from "@/lib/db";
import { assertSafeAuthEnvironment, authMode, readEnv } from "@/lib/env";
import type { Permission } from "@/lib/permissions";
import type { Principal, VerifiedIdentity } from "@/lib/auth/types";

type DatabasePrincipal = {
  user_id: string;
  external_subject: string | null;
  email: string;
  display_name: string | null;
  roles: string[];
  permissions: string[];
};

function safelyEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readTrustedGatewayIdentity(): Promise<VerifiedIdentity | null> {
  const expectedSecret = readEnv("AUTH_GATEWAY_SECRET");
  if (!expectedSecret) throw new Error("AUTH_MODE=trusted-gateway requires AUTH_GATEWAY_SECRET");

  const requestHeaders = await headers();
  const suppliedSecret = requestHeaders.get("x-pixbrik-gateway-secret");
  if (!suppliedSecret || !safelyEqual(suppliedSecret, expectedSecret)) return null;

  const subject = requestHeaders.get("x-pixbrik-user-subject")?.trim();
  const email = requestHeaders.get("x-pixbrik-user-email")?.trim().toLowerCase();
  if (!subject || !email || !email.includes("@")) return null;
  return {
    subject,
    email,
    displayName: requestHeaders.get("x-pixbrik-user-name") ?? undefined,
    provider: "trusted-gateway"
  };
}

function clerkSubject(userId: string): string {
  return `clerk:${userId}`;
}

/**
 * Clerk is authentication only. A verified, active session supplies an
 * immutable subject; PostgreSQL remains the authorization boundary.
 * Pending sessions (including setup-mfa) are deliberately treated as signed out.
 */
async function readClerkIdentity(): Promise<VerifiedIdentity | null> {
  const session = await auth({ treatPendingAsSignedOut: true });
  if (!session.isAuthenticated || !session.userId) return null;

  const user = await currentUser({ treatPendingAsSignedOut: true });
  if (!user || user.id !== session.userId || !user.twoFactorEnabled) return null;

  const primaryEmail = user.primaryEmailAddress;
  if (
    !primaryEmail
    || primaryEmail.id !== user.primaryEmailAddressId
    || primaryEmail.verification?.status !== "verified"
  ) {
    return null;
  }

  const email = primaryEmail.emailAddress.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  return {
    subject: clerkSubject(user.id),
    email,
    displayName: user.fullName ?? undefined,
    provider: "clerk",
    providerEmailId: primaryEmail.id
  };
}

async function resolveVerifiedIdentity(): Promise<VerifiedIdentity | null> {
  assertSafeAuthEnvironment();
  const mode = authMode();

  if (mode === "disabled") return null;
  if (mode === "development") {
    const email = readEnv("DEV_ADMIN_EMAIL") ?? "sam@benisty.ca";
    return {
      subject: `development:${email}`,
      email,
      displayName: "Local owner",
      provider: "development"
    };
  }
  if (mode === "trusted-gateway") return readTrustedGatewayIdentity();
  if (mode === "clerk") return readClerkIdentity();

  return null;
}

async function claimSeededClerkOwner(identity: VerifiedIdentity): Promise<boolean> {
  if (identity.provider !== "clerk" || !identity.providerEmailId) return false;
  const clerkEmailId = identity.providerEmailId;
  try {
    const rows = await withDatabaseRole("identity", async (sql) => {
      return sql<{ user_id: string }[]>`
        SELECT pixbrik.claim_seeded_clerk_owner(
          ${identity.subject.slice("clerk:".length)},
          ${identity.email},
          ${clerkEmailId},
          ${randomUUID()}::uuid
        )::text AS user_id
      `;
    });
    return Boolean(rows[0]?.user_id);
  } catch {
    // Invitation state and database errors are intentionally indistinguishable
    // to an authenticated but unauthorized identity.
    return false;
  }
}

async function loadDatabasePrincipal(identity: VerifiedIdentity): Promise<Principal | null> {
  const rows = await withDatabaseRole("admin", (sql) => sql<DatabasePrincipal[]>`
      SELECT
        u.id::text AS user_id,
        u.external_subject,
        u.email,
        u.display_name,
        COALESCE(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
        COALESCE(array_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions
      FROM pixbrik.app_user u
      LEFT JOIN pixbrik.user_role ur
        ON ur.user_id = u.id
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
      LEFT JOIN pixbrik.role r ON r.id = ur.role_id
      LEFT JOIN pixbrik.role_permission rp ON rp.role_id = r.id
      LEFT JOIN pixbrik.permission p ON p.id = rp.permission_id
      WHERE u.external_subject = ${identity.subject} AND u.status = 'active'
      GROUP BY u.id
      LIMIT 1
    `);
  const row = rows[0];
  if (!row) return null;

  return {
    ...identity,
    subject: identity.subject,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? identity.displayName,
    status: "active",
    roles: row.roles,
    permissions: row.permissions as Permission[]
  };
}

export async function getOptionalPrincipal(): Promise<Principal | null> {
  const identity = await resolveVerifiedIdentity();
  if (!identity) return null;

  if (identity.provider === "development") {
    return {
      ...identity,
      userId: "development-owner",
      status: "active",
      roles: ["owner"],
      permissions: ["*"]
    };
  }

  const existing = await loadDatabasePrincipal(identity);
  if (existing || identity.provider !== "clerk") return existing;

  const claimed = await claimSeededClerkOwner(identity);
  return claimed ? loadDatabasePrincipal(identity) : null;
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.permissions.some((granted) => granted === "*" || granted === permission);
}

export async function requirePrincipal(): Promise<Principal> {
  const principal = await getOptionalPrincipal();
  if (!principal) redirect("/sign-in");
  return principal;
}

export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!hasPermission(principal, permission)) redirect("/forbidden");
  return principal;
}
