import { timingSafeEqual } from "node:crypto";

import { dispatchEmailQueue } from "@/lib/email/outbox";
import { inspectEmailRuntime } from "@/lib/email/resend-client";
import { readEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function GET(request: Request): Promise<Response> {
  const secret = readEnv("CRON_SECRET");
  const authorization = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !authorization || !safeEqual(authorization, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!inspectEmailRuntime().ready) return json({ error: "Email runtime is not ready" }, 503);
  try {
    const result = await dispatchEmailQueue(25);
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Email dispatch job failed", { message: error instanceof Error ? error.message : "unknown" });
    return json({ error: "Email dispatch failed" }, 500);
  }
}
