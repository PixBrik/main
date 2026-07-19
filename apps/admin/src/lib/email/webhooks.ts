import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { WebhookEventPayload } from "resend";

import { withDatabaseRequestContext } from "@/lib/db";
import { getResendClient } from "@/lib/email/resend-client";
import { requireEnv } from "@/lib/env";

type WebhookHeaders = Readonly<{ id: string; timestamp: string; signature: string }>;

export type WebhookProcessingResult = Readonly<{
  duplicate: boolean;
  linkedMessage: boolean;
  suppressed: boolean;
}>;

export class ResendWebhookVerificationError extends Error {
  constructor() {
    super("Resend webhook signature is invalid");
    this.name = "ResendWebhookVerificationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EmailWebhookData = Readonly<{
  email_id: string;
  broadcast_id?: string;
  tags?: Record<string, string>;
  bounce?: { type?: string; subType?: string };
  failed?: { reason?: string };
  suppressed?: { type?: string };
}>;

function emailEvent(event: WebhookEventPayload): event is WebhookEventPayload & { data: EmailWebhookData } {
  return event.type !== "email.received" && "email_id" in event.data;
}

function eventMetadata(event: WebhookEventPayload): Record<string, unknown> {
  if (!emailEvent(event)) return { object: event.type.split(".")[0] };
  const data = event.data;
  return {
    broadcastId: data.broadcast_id ?? null,
    tags: data.tags ?? {},
    bounceType: data.bounce?.type ?? null,
    bounceSubtype: data.bounce?.subType ?? null,
    failedReason: data.failed?.reason?.slice(0, 240) ?? null,
    suppressedType: data.suppressed?.type ?? null
  };
}

function projectedStatus(type: string): string | null {
  if (type === "email.sent") return "sent";
  if (type === "email.delivered") return "delivered";
  if (type === "email.failed") return "failed";
  if (type === "email.bounced") return "bounced";
  if (type === "email.complained") return "complained";
  if (type === "email.suppressed") return "suppressed";
  return null;
}

function suppressionReason(event: WebhookEventPayload): "hard_bounce" | "complaint" | "provider_suppressed" | null {
  if (event.type === "email.complained") return "complaint";
  if (event.type === "email.suppressed") return "provider_suppressed";
  if (event.type === "email.bounced") {
    const type = event.data.bounce.type.toLowerCase();
    const subtype = event.data.bounce.subType.toLowerCase();
    if (type.includes("hard") || type.includes("permanent") || subtype.includes("hard") || subtype.includes("permanent")) {
      return "hard_bounce";
    }
  }
  return null;
}

export function verifyResendWebhook(payload: string, headers: WebhookHeaders): WebhookEventPayload {
  const webhookSecret = requireEnv("RESEND_WEBHOOK_SECRET");
  try {
    return getResendClient().webhooks.verify({ payload, headers, webhookSecret });
  } catch (error) {
    if (error instanceof Error && error.name === "WebhookVerificationError") {
      throw new ResendWebhookVerificationError();
    }
    throw error;
  }
}

export async function processResendWebhook(
  payload: string,
  headers: WebhookHeaders
): Promise<WebhookProcessingResult> {
  const event = verifyResendWebhook(payload, headers);
  const eventCreatedAt = new Date(event.created_at);
  if (Number.isNaN(eventCreatedAt.getTime())) throw new Error("Resend event timestamp is invalid");
  const payloadHash = createHash("sha256").update(payload).digest("hex");

  return withDatabaseRequestContext("service", {}, async (sql) => {
    const [evidence] = await sql<{ id: string }[]>`
      INSERT INTO pixbrik.provider_webhook_event (
        provider, provider_event_id, event_type, signature_verified, payload_hash
      ) VALUES ('resend', ${headers.id}, ${event.type}, true, ${payloadHash})
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id::text
    `;
    if (!evidence) return { duplicate: true, linkedMessage: false, suppressed: false };

    let linkedMessage = false;
    let suppressed = false;
    try {
      if (emailEvent(event)) {
        const taggedId = event.data.tags?.pixbrik_message;
        const safeTaggedId = taggedId && UUID_PATTERN.test(taggedId) ? taggedId : null;
        const [message] = await sql<{
          id: string;
          recipient: string;
          campaign_id: string | null;
          recovery_id: string | null;
        }[]>`
          SELECT id::text, recipient, campaign_id::text, recovery_id::text
          FROM pixbrik.outbound_message
          WHERE provider_message_id = ${event.data.email_id}
            OR (${safeTaggedId}::uuid IS NOT NULL AND id = ${safeTaggedId}::uuid
              AND (provider_message_id IS NULL OR provider_message_id = ${event.data.email_id}))
          ORDER BY (provider_message_id = ${event.data.email_id}) DESC
          LIMIT 1
          FOR UPDATE
        `;
        linkedMessage = Boolean(message);
        await sql`
          INSERT INTO pixbrik.email_delivery_event (
            outbound_message_id, webhook_event_id, provider_event_id,
            provider_message_id, event_type, event_created_at, metadata
          ) VALUES (
            ${message?.id ?? null}::uuid, ${evidence.id}::uuid, ${headers.id},
            ${event.data.email_id}, ${event.type}, ${eventCreatedAt},
            ${JSON.stringify(eventMetadata(event))}::jsonb
          )
        `;

        if (message) {
          const nextStatus = projectedStatus(event.type);
          await sql`
            WITH current_state AS (
              SELECT id, status, last_provider_event_at,
                CASE status
                  WHEN 'sent' THEN 2
                  WHEN 'failed' THEN 3
                  WHEN 'delivered' THEN 4
                  WHEN 'bounced' THEN 5
                  WHEN 'suppressed' THEN 6
                  WHEN 'complained' THEN 7
                  ELSE 0
                END AS current_rank
              FROM pixbrik.outbound_message
              WHERE id = ${message.id}::uuid
            ), ranked AS (
              SELECT current_state.*,
                CASE ${nextStatus}::text
                  WHEN 'sent' THEN 2
                  WHEN 'failed' THEN 3
                  WHEN 'delivered' THEN 4
                  WHEN 'bounced' THEN 5
                  WHEN 'suppressed' THEN 6
                  WHEN 'complained' THEN 7
                  ELSE 0
                END AS target_rank
              FROM current_state
            ), projected AS (
              SELECT ranked.*,
                ${nextStatus}::text IS NOT NULL AND (
                  target_rank > current_rank
                  OR (
                    target_rank = current_rank
                    AND (last_provider_event_at IS NULL OR ${eventCreatedAt} >= last_provider_event_at)
                  )
                  OR (
                    ${nextStatus}::text = 'sent'
                    AND status = 'failed'
                    AND last_provider_event_at IS NULL
                  )
                ) AS transition_applied
              FROM ranked
            )
            UPDATE pixbrik.outbound_message message
            SET provider_message_id = coalesce(message.provider_message_id, ${event.data.email_id}),
              status = CASE
                WHEN projected.transition_applied
                  THEN ${nextStatus}::pixbrik.message_status
                ELSE message.status
              END,
              sent_at = CASE WHEN ${event.type} = 'email.sent' THEN coalesce(message.sent_at, ${eventCreatedAt}) ELSE message.sent_at END,
              delivered_at = CASE WHEN ${event.type} = 'email.delivered' THEN coalesce(message.delivered_at, ${eventCreatedAt}) ELSE message.delivered_at END,
              failure_summary = CASE
                WHEN NOT projected.transition_applied THEN message.failure_summary
                WHEN ${nextStatus}::text IN ('failed', 'bounced', 'complained', 'suppressed')
                  THEN ${`Provider event: ${event.type}`}
                ELSE NULL
              END,
              next_attempt_at = CASE WHEN projected.transition_applied THEN NULL ELSE message.next_attempt_at END,
              locked_at = CASE WHEN projected.transition_applied THEN NULL ELSE message.locked_at END,
              locked_by = CASE WHEN projected.transition_applied THEN NULL ELSE message.locked_by END,
              lease_token = CASE WHEN projected.transition_applied THEN NULL ELSE message.lease_token END,
              lease_expires_at = CASE WHEN projected.transition_applied THEN NULL ELSE message.lease_expires_at END,
              last_provider_event_at = CASE
                WHEN ${nextStatus}::text IS NULL THEN message.last_provider_event_at
                ELSE greatest(coalesce(message.last_provider_event_at, ${eventCreatedAt}), ${eventCreatedAt})
              END
            FROM projected
            WHERE message.id = projected.id
          `;
          if (message.recovery_id) {
            await sql`
              UPDATE pixbrik.checkout_recovery
              SET recovery_email_sent_at = coalesce(recovery_email_sent_at, ${eventCreatedAt})
              WHERE id = ${message.recovery_id}::uuid
            `;
          }
          if (message.campaign_id && ["email.failed", "email.bounced", "email.complained", "email.suppressed"].includes(event.type)) {
            await sql`
              UPDATE pixbrik.email_campaign
              SET status = 'completed_with_errors'
              WHERE id = ${message.campaign_id}::uuid AND status = 'completed'
            `;
          }
          const reason = suppressionReason(event);
          if (reason) {
            await sql`
              SELECT pixbrik.record_email_suppression(
                ${message.recipient}, ${reason}, 'resend.webhook', ${headers.id}, ${event.type}
              )
            `;
            suppressed = true;
          }
        }
      } else if (event.type === "contact.updated" && event.data.unsubscribed) {
        const [contact] = await sql<{ unsubscribe_token: string }[]>`
          SELECT unsubscribe_token::text
          FROM pixbrik.marketing_contact
          WHERE email = ${event.data.email.toLowerCase()}
          LIMIT 1
        `;
        if (contact) {
          await sql`
            SELECT * FROM pixbrik.unsubscribe_marketing_contact(
              ${contact.unsubscribe_token}::uuid, 'resend.contact.updated', ${randomUUID()}::uuid
            )
          `;
        }
      }

      await sql`
        UPDATE pixbrik.provider_webhook_event
        SET processing_status = 'processed', processed_at = now(), error_summary = NULL
        WHERE id = ${evidence.id}::uuid
      `;
      return { duplicate: false, linkedMessage, suppressed };
    } catch (error) {
      // Roll the evidence insert back deliberately. Resend will retry the same
      // signed event and the unique provider key will be available again.
      throw error;
    }
  });
}
