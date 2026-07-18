import "server-only";

import { timingSafeEqual } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { withDatabaseRole } from "@/lib/db";
import { assertSafeAuthEnvironment, readEnv } from "@/lib/env";
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
  return { subject, email, displayName: requestHeaders.get("x-pixbrik-user-name") ?? undefined };
}

async function resolveVerifiedIdentity(): Promise<VerifiedIdentity | null> {
  assertSafeAuthEnvironment();
  const mode = readEnv("AUTH_MODE") ?? "disabled";

  if (mode === "disabled") return null;
  if (mode === "development") {
    const email = readEnv("DEV_ADMIN_EMAIL") ?? "sam@benisty.ca";
    return { subject: `development:${email}`, email, displayName: "Local owner" };
  }
  if (mode === "trusted-gateway") return readTrustedGatewayIdentity();

  throw new Error(`Unsupported AUTH_MODE: ${mode}`);
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

  if ((readEnv("AUTH_MODE") ?? "disabled") === "development") {
    return {
      ...identity,
      userId: "development-owner",
      status: "active",
      roles: ["owner"],
      permissions: ["*"]
    };
  }

  return loadDatabasePrincipal(identity);
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
