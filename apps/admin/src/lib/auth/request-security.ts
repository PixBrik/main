import "server-only";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import { appOrigin } from "@/lib/env";
import { digestPrivateMetadata } from "@/lib/auth/password";

export type AuthRequestContext = Readonly<{
  requestId: string;
  ipDigest: string;
  userAgentDigest: string;
}>;

export class UntrustedMutationError extends Error {
  constructor() {
    super("The request origin could not be verified");
    this.name = "UntrustedMutationError";
  }
}

function firstForwardedValue(value: string | null): string {
  const first = value?.split(",", 1)[0]?.trim();
  return first?.slice(0, 256) || "unavailable";
}

/**
 * Server Actions are public POST endpoints. Every state-changing password-auth
 * action calls this guard in addition to Next.js' own Server Action checks.
 */
export async function requireTrustedMutation(): Promise<AuthRequestContext> {
  const requestHeaders = await headers();
  const trustedOrigin = appOrigin();
  const suppliedOrigin = requestHeaders.get("origin");
  const fetchSite = requestHeaders.get("sec-fetch-site")?.toLowerCase();

  let parsedOrigin: string | null = null;
  try {
    parsedOrigin = suppliedOrigin ? new URL(suppliedOrigin).origin : null;
  } catch {
    parsedOrigin = null;
  }

  if (!trustedOrigin || parsedOrigin !== trustedOrigin) throw new UntrustedMutationError();
  if (fetchSite && fetchSite !== "same-origin") throw new UntrustedMutationError();

  const clientIp = firstForwardedValue(
    requestHeaders.get("x-vercel-forwarded-for") ?? requestHeaders.get("x-forwarded-for")
  );
  const userAgent = (requestHeaders.get("user-agent") ?? "unavailable").slice(0, 1_024);

  return {
    requestId: randomUUID(),
    ipDigest: digestPrivateMetadata("client-ip", clientIp).digest,
    userAgentDigest: digestPrivateMetadata("user-agent", userAgent).digest
  };
}
