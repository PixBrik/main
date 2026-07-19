import {
  processResendWebhook,
  ResendWebhookVerificationError
} from "@/lib/email/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return response({ error: "Payload too large" }, 413);
  }
  const id = request.headers.get("svix-id")?.trim();
  const timestamp = request.headers.get("svix-timestamp")?.trim();
  const signature = request.headers.get("svix-signature")?.trim();
  if (!id || !timestamp || !signature) return response({ error: "Invalid signature" }, 400);
  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
    return response({ error: "Payload too large" }, 413);
  }
  try {
    const result = await processResendWebhook(payload, { id, timestamp, signature });
    return response({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    const signatureError = error instanceof ResendWebhookVerificationError;
    if (!signatureError) console.error("Resend webhook processing failed", { eventId: id });
    return response({ error: signatureError ? "Invalid signature" : "Processing failed" }, signatureError ? 400 : 500);
  }
}
