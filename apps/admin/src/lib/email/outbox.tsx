import "server-only";

import { randomUUID } from "node:crypto";

import type { TransactionSql } from "postgres";

import { withDatabaseRequestContext } from "@/lib/db";
import {
  parseEmailContentDefinition,
  personalizeEmailContent,
  pixBrikEmailText,
  renderPixBrikEmail
} from "@/lib/email/email-template";
import {
  automationCapability,
  customerFacingUrl,
  emailRuntimeConfiguration,
  getResendClient,
  unsubscribeUrls
} from "@/lib/email/resend-client";

type AutomationRule = Readonly<{
  id: string;
  source_event: string;
  template_key: string;
  template_version: number;
  delay_minutes: number;
  requires_marketing_consent: boolean;
  enabled_at: Date | string;
}>;

type ClaimedMessage = Readonly<{
  id: string;
  recipient: string;
  locale_code: string;
  payload: unknown;
  idempotency_key: string;
  message_kind: "transactional" | "marketing";
  recovery_id: string | null;
  campaign_id: string | null;
  subject_snapshot: string | null;
  content_snapshot: unknown;
  attempt_count: number;
  first_attempt_at: Date | string;
  lease_token: string;
  contact_status: string | null;
  unsubscribe_token: string | null;
  suppression_reason: string | null;
  sender_snapshot: string | null;
  reply_to_snapshot: string | null;
  rendered_html_snapshot: string | null;
  rendered_text_snapshot: string | null;
  headers_snapshot: unknown;
  provider_tags_snapshot: unknown;
}>;

export type EmailDispatchResult = Readonly<{
  campaignsMaterialized: number;
  automationMessagesQueued: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  campaignsCompleted: number;
}>;

function safeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Email provider request failed";
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[recipient]").slice(0, 480);
}

async function loadEnabledRules(sql: TransactionSql): Promise<AutomationRule[]> {
  return sql<AutomationRule[]>`
    SELECT id::text, source_event, template_key, template_version,
      delay_minutes, requires_marketing_consent, enabled_at
    FROM pixbrik.email_automation_rule
    WHERE enabled
    ORDER BY rule_key
  `;
}

async function enqueueWelcome(sql: TransactionSql, rule: AutomationRule): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.outbound_message (
      recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
      next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
      automation_rule_id, subject_snapshot, content_snapshot
    )
    SELECT account.email, template.id, template.locale_code,
      jsonb_build_object('customerId', account.id::text, 'displayName', account.display_name),
      'automation:' || ${rule.id} || ':customer:' || account.id::text,
      account.created_at + make_interval(mins => ${rule.delay_minutes}),
      account.created_at + make_interval(mins => ${rule.delay_minutes}),
      'transactional', account.id, contact.id, ${rule.id}::uuid,
      template.subject, template.content_definition
    FROM pixbrik.app_user account
    LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = account.id
    JOIN LATERAL (
      SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
      FROM pixbrik.communication_template candidate
      WHERE candidate.template_key = ${rule.template_key}
        AND candidate.version = ${rule.template_version}
        AND candidate.status = 'approved'
        AND candidate.locale_code IN (account.preferred_locale, 'en')
      ORDER BY (candidate.locale_code = account.preferred_locale) DESC
      LIMIT 1
    ) template ON true
    WHERE account.kind = 'customer' AND account.status = 'active'
      AND account.email_verified_at IS NOT NULL
      AND account.created_at >= ${rule.enabled_at}
      AND account.created_at + make_interval(mins => ${rule.delay_minutes}) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.email_suppression suppression
        WHERE suppression.email = account.email AND suppression.released_at IS NULL
      )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text
  `;
  return rows.length;
}

async function enqueueAbandonedCheckout(sql: TransactionSql, rule: AutomationRule): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.outbound_message (
      recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
      next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
      recovery_id, automation_rule_id, subject_snapshot, content_snapshot
    )
    SELECT recovery.email, template.id, template.locale_code,
      jsonb_build_object('recoveryId', recovery.id::text, 'stage', recovery.stage),
      'automation:' || ${rule.id} || ':recovery:' || recovery.id::text,
      recovery.abandoned_at + make_interval(mins => ${rule.delay_minutes}),
      recovery.abandoned_at + make_interval(mins => ${rule.delay_minutes}),
      'marketing', recovery.customer_user_id, contact.id, recovery.id, ${rule.id}::uuid,
      template.subject, template.content_definition
    FROM pixbrik.checkout_recovery recovery
    JOIN pixbrik.marketing_contact contact ON contact.email = recovery.email
      AND contact.status = 'subscribed'
    JOIN LATERAL (
      SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
      FROM pixbrik.communication_template candidate
      WHERE candidate.template_key = ${rule.template_key}
        AND candidate.version = ${rule.template_version}
        AND candidate.status = 'approved'
        AND candidate.locale_code IN (recovery.locale_code, 'en')
      ORDER BY (candidate.locale_code = recovery.locale_code) DESC
      LIMIT 1
    ) template ON true
    WHERE recovery.email IS NOT NULL
      AND recovery.email_marketing_consent
      AND recovery.abandoned_at >= ${rule.enabled_at}
      AND recovery.converted_at IS NULL
      AND recovery.expires_at > now()
      AND recovery.abandoned_at + make_interval(mins => ${rule.delay_minutes}) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.email_suppression suppression
        WHERE suppression.email = recovery.email AND suppression.released_at IS NULL
      )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text
  `;
  return rows.length;
}

async function enqueuePlacedOrders(sql: TransactionSql, rule: AutomationRule): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.outbound_message (
      recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
      next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
      order_id, automation_rule_id, subject_snapshot, content_snapshot
    )
    SELECT orders.customer_email, template.id, template.locale_code,
      jsonb_build_object('orderId', orders.id::text, 'orderNumber', orders.order_number),
      'automation:' || ${rule.id} || ':order:' || orders.id::text,
      orders.placed_at + make_interval(mins => ${rule.delay_minutes}),
      orders.placed_at + make_interval(mins => ${rule.delay_minutes}),
      'transactional', orders.customer_user_id, contact.id, orders.id, ${rule.id}::uuid,
      template.subject, template.content_definition
    FROM pixbrik.commerce_order orders
    LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = orders.customer_user_id
    JOIN LATERAL (
      SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
      FROM pixbrik.communication_template candidate
      WHERE candidate.template_key = ${rule.template_key}
        AND candidate.version = ${rule.template_version}
        AND candidate.status = 'approved'
        AND candidate.locale_code IN (orders.locale_code, 'en')
      ORDER BY (candidate.locale_code = orders.locale_code) DESC
      LIMIT 1
    ) template ON true
    WHERE orders.placed_at IS NOT NULL
      AND orders.placed_at >= ${rule.enabled_at}
      AND orders.placed_at + make_interval(mins => ${rule.delay_minutes}) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.email_suppression suppression
        WHERE suppression.email = orders.customer_email AND suppression.released_at IS NULL
      )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text
  `;
  return rows.length;
}

async function enqueueFailedPayments(sql: TransactionSql, rule: AutomationRule): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.outbound_message (
      recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
      next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
      order_id, payment_transaction_id, automation_rule_id, subject_snapshot, content_snapshot
    )
    SELECT orders.customer_email, template.id, template.locale_code,
      jsonb_build_object('orderId', orders.id::text, 'orderNumber', orders.order_number),
      'automation:' || ${rule.id} || ':payment:' || payment.id::text,
      payment.created_at + make_interval(mins => ${rule.delay_minutes}),
      payment.created_at + make_interval(mins => ${rule.delay_minutes}),
      'transactional', orders.customer_user_id, contact.id, orders.id, payment.id, ${rule.id}::uuid,
      template.subject, template.content_definition
    FROM pixbrik.payment_transaction payment
    JOIN pixbrik.commerce_order orders ON orders.id = payment.order_id
    LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = orders.customer_user_id
    JOIN LATERAL (
      SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
      FROM pixbrik.communication_template candidate
      WHERE candidate.template_key = ${rule.template_key}
        AND candidate.version = ${rule.template_version}
        AND candidate.status = 'approved'
        AND candidate.locale_code IN (orders.locale_code, 'en')
      ORDER BY (candidate.locale_code = orders.locale_code) DESC
      LIMIT 1
    ) template ON true
    WHERE payment.status = 'failed'
      AND payment.kind IN ('authorization', 'capture', 'payment')
      AND orders.paid_at IS NULL
      AND payment.created_at >= ${rule.enabled_at}
      AND payment.created_at + make_interval(mins => ${rule.delay_minutes}) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.payment_transaction recovered
        WHERE recovered.order_id = payment.order_id
          AND recovered.status = 'succeeded'
          AND recovered.created_at > payment.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.payment_transaction later_failure
        WHERE later_failure.order_id = payment.order_id
          AND later_failure.status = 'failed'
          AND later_failure.kind IN ('authorization', 'capture', 'payment')
          AND later_failure.created_at > payment.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.email_suppression suppression
        WHERE suppression.email = orders.customer_email AND suppression.released_at IS NULL
      )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text
  `;
  return rows.length;
}

async function enqueueOrderState(
  sql: TransactionSql,
  rule: AutomationRule,
  targetStatus: "shipped" | "delivered",
  marketing: boolean
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.outbound_message (
      recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
      next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
      order_id, automation_rule_id, subject_snapshot, content_snapshot
    )
    SELECT orders.customer_email, template.id, template.locale_code,
      jsonb_build_object('orderId', orders.id::text, 'orderNumber', orders.order_number),
      'automation:' || ${rule.id} || ':order:' || orders.id::text,
      source.occurred_at + make_interval(mins => ${rule.delay_minutes}),
      source.occurred_at + make_interval(mins => ${rule.delay_minutes}),
      ${marketing ? "marketing" : "transactional"}, orders.customer_user_id, contact.id,
      orders.id, ${rule.id}::uuid, template.subject, template.content_definition
    FROM pixbrik.commerce_order orders
    JOIN LATERAL (
      SELECT coalesce(min(event.occurred_at), orders.updated_at) AS occurred_at
      FROM pixbrik.order_event event
      WHERE event.order_id = orders.id AND event.to_status::text = ${targetStatus}
    ) source ON true
    ${marketing
      ? sql`JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = orders.customer_user_id AND contact.email = orders.customer_email AND contact.status = 'subscribed'`
      : sql`LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = orders.customer_user_id`}
    JOIN LATERAL (
      SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
      FROM pixbrik.communication_template candidate
      WHERE candidate.template_key = ${rule.template_key}
        AND candidate.version = ${rule.template_version}
        AND candidate.status = 'approved'
        AND candidate.locale_code IN (orders.locale_code, 'en')
      ORDER BY (candidate.locale_code = orders.locale_code) DESC
      LIMIT 1
    ) template ON true
    WHERE ${targetStatus === "shipped"
      ? sql`orders.status IN ('shipped', 'delivered')`
      : sql`orders.status = 'delivered'`}
      AND source.occurred_at >= ${rule.enabled_at}
      AND source.occurred_at + make_interval(mins => ${rule.delay_minutes}) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM pixbrik.email_suppression suppression
        WHERE suppression.email = orders.customer_email AND suppression.released_at IS NULL
      )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id::text
  `;
  return rows.length;
}

async function enqueueDueAutomations(sql: TransactionSql): Promise<number> {
  const rules = await loadEnabledRules(sql);
  let queued = 0;
  for (const rule of rules) {
    if (!automationCapability(rule.source_event).ready) continue;
    const expectsMarketing = ["checkout.abandoned", "order.delivered"].includes(rule.source_event);
    if (expectsMarketing !== rule.requires_marketing_consent) {
      throw new Error(`Automation ${rule.id} has an invalid consent policy`);
    }
    if (rule.source_event === "customer.created") queued += await enqueueWelcome(sql, rule);
    else if (rule.source_event === "checkout.abandoned") queued += await enqueueAbandonedCheckout(sql, rule);
    else if (rule.source_event === "order.placed") queued += await enqueuePlacedOrders(sql, rule);
    else if (rule.source_event === "payment.failed") queued += await enqueueFailedPayments(sql, rule);
    else if (rule.source_event === "order.shipped") queued += await enqueueOrderState(sql, rule, "shipped", false);
    else if (rule.source_event === "order.delivered") queued += await enqueueOrderState(sql, rule, "delivered", true);
  }
  return queued;
}

async function materializeCampaigns(sql: TransactionSql): Promise<number> {
  const due = await sql<{
    id: string;
    template_key: string;
    template_version: number;
    audience_key: string;
    recipient_cap: number;
  }[]>`
    SELECT id::text, template_key, template_version, audience_key, recipient_cap
    FROM pixbrik.email_campaign
    WHERE status = 'scheduled' AND scheduled_at <= now()
    ORDER BY scheduled_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 5
  `;
  for (const campaign of due) {
    await sql`
      UPDATE pixbrik.email_campaign
      SET status = 'processing', started_at = coalesce(started_at, now())
      WHERE id = ${campaign.id}::uuid AND status = 'scheduled'
    `;
    await sql`
      INSERT INTO pixbrik.outbound_message (
        recipient, template_id, locale_code, payload, idempotency_key, scheduled_at,
        next_attempt_at, message_kind, customer_user_id, marketing_contact_id,
        campaign_id, subject_snapshot, content_snapshot
      )
      SELECT contact.email, template.id, template.locale_code,
        jsonb_build_object('campaignId', ${campaign.id}, 'displayName', contact.display_name),
        'campaign:' || ${campaign.id} || ':contact:' || contact.id::text || ':v' || ${campaign.template_version}::text,
        now(), now(), 'marketing', contact.customer_user_id, contact.id, ${campaign.id}::uuid,
        template.subject, template.content_definition
      FROM pixbrik.marketing_contact contact
      JOIN LATERAL (
        SELECT candidate.id, candidate.locale_code, candidate.subject, candidate.content_definition
        FROM pixbrik.communication_template candidate
        WHERE candidate.template_key = ${campaign.template_key}
          AND candidate.version = ${campaign.template_version}
          AND candidate.status = 'approved'
          AND candidate.locale_code IN (contact.locale_code, 'en')
        ORDER BY (candidate.locale_code = contact.locale_code) DESC
        LIMIT 1
      ) template ON true
      WHERE contact.status = 'subscribed'
        AND (
          ${campaign.audience_key === "all_subscribers"}
          OR (${campaign.audience_key === "registered_customers"} AND contact.customer_user_id IS NOT NULL)
          OR (${campaign.audience_key === "past_buyers"} AND EXISTS (
            SELECT 1 FROM pixbrik.commerce_order orders
            WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
          ))
          OR (${campaign.audience_key === "no_orders"} AND NOT EXISTS (
            SELECT 1 FROM pixbrik.commerce_order orders
            WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM pixbrik.email_suppression suppression
          WHERE suppression.email = contact.email AND suppression.released_at IS NULL
        )
      ORDER BY contact.id
      LIMIT ${campaign.recipient_cap}
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
    await sql`
      INSERT INTO pixbrik.email_campaign_recipient (
        campaign_id, marketing_contact_id, outbound_message_id, recipient_snapshot, locale_code
      )
      SELECT message.campaign_id, message.marketing_contact_id, message.id,
        message.recipient, message.locale_code
      FROM pixbrik.outbound_message message
      WHERE message.campaign_id = ${campaign.id}::uuid
        AND message.marketing_contact_id IS NOT NULL
      ON CONFLICT (campaign_id, marketing_contact_id) DO NOTHING
    `;
  }
  return due.length;
}

async function claimDueMessages(sql: TransactionSql, workerId: string, limit: number): Promise<ClaimedMessage[]> {
  await sql`
    UPDATE pixbrik.outbound_message
    SET status = 'failed', failure_summary = 'Unknown provider outcome; manual reconciliation required',
      next_attempt_at = NULL, locked_at = NULL, locked_by = NULL,
      lease_token = NULL, lease_expires_at = NULL
    WHERE status = 'sending' AND lease_expires_at < now()
      AND first_attempt_at < now() - interval '23 hours'
  `;
  await sql`
    UPDATE pixbrik.outbound_message
    SET status = 'queued', locked_at = NULL, locked_by = NULL,
      lease_token = NULL, lease_expires_at = NULL,
      next_attempt_at = now()
    WHERE status = 'sending' AND lease_expires_at < now()
      AND first_attempt_at >= now() - interval '23 hours'
  `;

  const leaseToken = randomUUID();
  const claimed = await sql<{ id: string }[]>`
    WITH candidates AS (
      SELECT id
      FROM pixbrik.outbound_message
      WHERE (
        status = 'queued'
        OR (status = 'failed' AND next_attempt_at IS NOT NULL AND attempt_count < 5)
      )
        AND coalesce(next_attempt_at, scheduled_at) <= now()
        AND attempt_count < 5
      ORDER BY (message_kind = 'transactional') DESC,
        coalesce(next_attempt_at, scheduled_at), created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(limit, 50))}
    )
    UPDATE pixbrik.outbound_message message
    SET status = 'sending', attempt_count = message.attempt_count + 1,
      first_attempt_at = coalesce(message.first_attempt_at, now()),
      last_attempt_at = now(), locked_at = now(), locked_by = ${workerId},
      lease_token = ${leaseToken}::uuid, lease_expires_at = now() + interval '5 minutes'
    FROM candidates
    WHERE message.id = candidates.id
    RETURNING message.id::text
  `;
  if (claimed.length === 0) return [];
  const ids = claimed.map((row) => row.id);
  return sql<ClaimedMessage[]>`
    SELECT message.id::text, message.recipient, message.locale_code,
      message.payload, message.idempotency_key, message.message_kind,
      message.recovery_id::text, message.campaign_id::text,
      message.subject_snapshot, message.content_snapshot, message.attempt_count,
      message.first_attempt_at, message.lease_token::text,
      message.sender_snapshot, message.reply_to_snapshot,
      message.rendered_html_snapshot, message.rendered_text_snapshot,
      message.headers_snapshot, message.provider_tags_snapshot,
      contact.status AS contact_status, contact.unsubscribe_token::text,
      suppression.reason AS suppression_reason
    FROM pixbrik.outbound_message message
    LEFT JOIN pixbrik.marketing_contact contact ON contact.id = message.marketing_contact_id
    LEFT JOIN pixbrik.email_suppression suppression ON suppression.email = message.recipient
      AND suppression.released_at IS NULL
    WHERE message.id = ANY(${ids}::uuid[]) AND message.lease_token = ${leaseToken}::uuid
    ORDER BY message.created_at
  `;
}

async function finalizeSuppressed(message: ClaimedMessage, reason: string): Promise<boolean> {
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE pixbrik.outbound_message
      SET status = 'suppressed', failure_summary = ${reason.slice(0, 480)},
        next_attempt_at = NULL, locked_at = NULL, locked_by = NULL,
        lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${message.id}::uuid AND lease_token = ${message.lease_token}::uuid
      RETURNING id::text
    `;
    return rows.length === 1;
  });
}

async function finalizeSuccess(message: ClaimedMessage, providerMessageId: string): Promise<boolean> {
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE pixbrik.outbound_message
      SET status = 'sent', provider_message_id = ${providerMessageId}, sent_at = now(),
        failure_summary = NULL, next_attempt_at = NULL, locked_at = NULL, locked_by = NULL,
        lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${message.id}::uuid AND lease_token = ${message.lease_token}::uuid
      RETURNING id::text
    `;
    if (rows.length === 1 && message.recovery_id) {
      await sql`
        UPDATE pixbrik.checkout_recovery
        SET recovery_email_sent_at = coalesce(recovery_email_sent_at, now())
        WHERE id = ${message.recovery_id}::uuid
      `;
    }
    return rows.length === 1;
  });
}

async function finalizeFailure(message: ClaimedMessage, error: unknown): Promise<"retry" | "failed" | "stale"> {
  const firstAttempt = new Date(message.first_attempt_at).getTime();
  const withinProviderWindow = firstAttempt > Date.now() - 22 * 60 * 60 * 1_000;
  const retry = message.attempt_count < 5 && withinProviderWindow;
  const backoffMinutes = [5, 15, 60, 240][Math.max(0, message.attempt_count - 1)] ?? 240;
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      UPDATE pixbrik.outbound_message
      SET status = ${retry ? "queued" : "failed"}, failure_summary = ${safeFailure(error)},
        next_attempt_at = ${retry ? new Date(Date.now() + backoffMinutes * 60_000) : null},
        locked_at = NULL, locked_by = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${message.id}::uuid AND lease_token = ${message.lease_token}::uuid
      RETURNING id::text
    `;
    if (rows.length === 0) return "stale";
    return retry ? "retry" : "failed";
  });
}

async function refreshClaimForSend(message: ClaimedMessage): Promise<ClaimedMessage | null> {
  return withDatabaseRequestContext("service", {}, async (sql) => {
    const renewed = await sql<{ id: string }[]>`
      UPDATE pixbrik.outbound_message
      SET lease_expires_at = now() + interval '5 minutes'
      WHERE id = ${message.id}::uuid
        AND status = 'sending'
        AND lease_token = ${message.lease_token}::uuid
        AND lease_expires_at > now()
      RETURNING id::text
    `;
    if (renewed.length !== 1) return null;
    const [fresh] = await sql<{
      contact_status: string | null;
      unsubscribe_token: string | null;
      suppression_reason: string | null;
    }[]>`
      SELECT CASE
          WHEN contact.id IS NOT NULL AND lower(contact.email) <> lower(message.recipient)
            THEN 'recipient_mismatch'
          ELSE contact.status
        END AS contact_status,
        contact.unsubscribe_token::text,
        suppression.reason AS suppression_reason
      FROM pixbrik.outbound_message message
      LEFT JOIN pixbrik.marketing_contact contact ON contact.id = message.marketing_contact_id
      LEFT JOIN pixbrik.email_suppression suppression ON suppression.email = message.recipient
        AND suppression.released_at IS NULL
      WHERE message.id = ${message.id}::uuid
        AND message.lease_token = ${message.lease_token}::uuid
    `;
    if (!fresh) return null;
    return { ...message, ...fresh };
  });
}

type ProviderEnvelope = Readonly<{
  from: string;
  replyTo: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: readonly Readonly<{ name: string; value: string }>[];
}>;

function providerEnvelope(message: ClaimedMessage): ProviderEnvelope | null {
  if (!message.sender_snapshot || !message.reply_to_snapshot
    || !message.rendered_html_snapshot || !message.rendered_text_snapshot) return null;
  if (!message.headers_snapshot || typeof message.headers_snapshot !== "object" || Array.isArray(message.headers_snapshot)) {
    throw new Error("Email header snapshot is invalid");
  }
  const headers = Object.fromEntries(Object.entries(message.headers_snapshot as Record<string, unknown>).map(([key, value]) => {
    if (typeof value !== "string" || /[\r\n]/u.test(key) || /[\r\n]/u.test(value)) {
      throw new Error("Email header snapshot is invalid");
    }
    return [key, value];
  }));
  if (!Array.isArray(message.provider_tags_snapshot)) throw new Error("Email provider tag snapshot is invalid");
  const tags = message.provider_tags_snapshot.map((tag) => {
    if (!tag || typeof tag !== "object" || Array.isArray(tag)) throw new Error("Email provider tag snapshot is invalid");
    const { name, value } = tag as Record<string, unknown>;
    if (typeof name !== "string" || typeof value !== "string") throw new Error("Email provider tag snapshot is invalid");
    return { name, value };
  });
  return {
    from: message.sender_snapshot,
    replyTo: message.reply_to_snapshot,
    html: message.rendered_html_snapshot,
    text: message.rendered_text_snapshot,
    headers,
    tags
  };
}

async function freezeProviderEnvelope(
  message: ClaimedMessage,
  content: ReturnType<typeof parseEmailContentDefinition>
): Promise<Readonly<{ message: ClaimedMessage; envelope: ProviderEnvelope }>> {
  const existing = providerEnvelope(message);
  if (existing) return { message, envelope: existing };

  const configuration = emailRuntimeConfiguration();
  const personalized = personalizeEmailContent(content, message.payload, message.locale_code);
  const ctaUrl = customerFacingUrl(personalized.ctaPath);
  const unsubscribe = personalized.purpose === "marketing" && message.unsubscribe_token
    ? unsubscribeUrls(message.unsubscribe_token)
    : undefined;
  const headers = unsubscribe ? {
    "List-Unsubscribe": `<${unsubscribe.oneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  } : {};
  const tags = [
    { name: "message_kind", value: message.message_kind },
    { name: "pixbrik_message", value: message.id }
  ];
  const html = await renderPixBrikEmail({
    previewText: personalized.previewText,
    content: personalized,
    ctaUrl,
    locale: message.locale_code,
    unsubscribeUrl: unsubscribe?.page
  });
  const text = pixBrikEmailText({
    content: personalized,
    ctaUrl,
    unsubscribeUrl: unsubscribe?.page,
    locale: message.locale_code
  });
  const [snapshot] = await withDatabaseRequestContext("service", {}, (sql) => sql<{
    sender_snapshot: string;
    reply_to_snapshot: string;
    rendered_html_snapshot: string;
    rendered_text_snapshot: string;
    headers_snapshot: unknown;
    provider_tags_snapshot: unknown;
  }[]>`
    UPDATE pixbrik.outbound_message
    SET sender_snapshot = ${configuration.from}, reply_to_snapshot = ${configuration.replyTo},
      rendered_html_snapshot = ${html}, rendered_text_snapshot = ${text},
      headers_snapshot = ${JSON.stringify(headers)}::text::jsonb,
      provider_tags_snapshot = ${JSON.stringify(tags)}::text::jsonb
    WHERE id = ${message.id}::uuid AND status = 'sending'
      AND lease_token = ${message.lease_token}::uuid
      AND lease_expires_at > now()
      AND rendered_html_snapshot IS NULL
    RETURNING sender_snapshot, reply_to_snapshot, rendered_html_snapshot,
      rendered_text_snapshot, headers_snapshot, provider_tags_snapshot
  `);
  if (!snapshot) throw new Error("Email provider envelope could not be frozen");
  const frozenMessage = { ...message, ...snapshot };
  const envelope = providerEnvelope(frozenMessage);
  if (!envelope) throw new Error("Email provider envelope is incomplete");
  return { message: frozenMessage, envelope };
}

async function sendClaimedMessage(claimed: ClaimedMessage): Promise<"sent" | "retry" | "failed" | "suppressed" | "stale"> {
  const refreshed = await refreshClaimForSend(claimed);
  if (!refreshed) return "stale";
  let message = refreshed;
  if (message.suppression_reason) {
    return await finalizeSuppressed(message, `Suppressed: ${message.suppression_reason}`) ? "suppressed" : "stale";
  }
  if (message.message_kind === "marketing" && (message.contact_status !== "subscribed" || !message.unsubscribe_token)) {
    return await finalizeSuppressed(message, "Marketing consent is no longer active") ? "suppressed" : "stale";
  }

  try {
    const subject = message.subject_snapshot?.trim();
    if (!subject || subject.length > 998 || /\r|\n/.test(subject)) throw new Error("Email subject snapshot is invalid");
    let envelope = providerEnvelope(message);
    if (!envelope) {
      const content = parseEmailContentDefinition(message.content_snapshot);
      if (content.purpose !== message.message_kind) throw new Error("Email purpose does not match message kind");
      const frozen = await freezeProviderEnvelope(message, content);
      message = frozen.message;
      envelope = frozen.envelope;
    }
    const result = await getResendClient().emails.send({
      from: envelope.from,
      to: [message.recipient],
      replyTo: envelope.replyTo,
      subject,
      html: envelope.html,
      text: envelope.text,
      headers: envelope.headers,
      tags: [...envelope.tags]
    }, { idempotencyKey: message.idempotency_key });
    if (result.error || !result.data?.id) throw new Error(result.error?.message ?? "Resend returned no message identifier");
    return await finalizeSuccess(message, result.data.id) ? "sent" : "stale";
  } catch (error) {
    return finalizeFailure(message, error);
  }
}

async function reconcileCampaigns(sql: TransactionSql): Promise<number> {
  const campaigns = await sql<{ id: string; failed: string; pending: string; recipients: string }[]>`
    SELECT campaign.id::text,
      count(message.id) FILTER (WHERE message.status IN ('failed', 'bounced', 'complained', 'suppressed'))::text AS failed,
      count(message.id) FILTER (WHERE message.status IN ('queued', 'sending'))::text AS pending,
      count(message.id)::text AS recipients
    FROM pixbrik.email_campaign campaign
    LEFT JOIN pixbrik.outbound_message message ON message.campaign_id = campaign.id
    WHERE campaign.status = 'processing'
    GROUP BY campaign.id
    HAVING count(message.id) FILTER (WHERE message.status IN ('queued', 'sending')) = 0
  `;
  for (const campaign of campaigns) {
    await sql`
      UPDATE pixbrik.email_campaign
      SET status = ${Number(campaign.failed) > 0 ? "completed_with_errors" : "completed"}, completed_at = now()
      WHERE id = ${campaign.id}::uuid AND status = 'processing'
    `;
  }
  return campaigns.length;
}

export async function dispatchEmailQueue(limit = 25): Promise<EmailDispatchResult> {
  const workerId = `email-${randomUUID()}`;
  const prepared = await withDatabaseRequestContext("service", {}, async (sql) => ({
    campaignsMaterialized: await materializeCampaigns(sql),
    automationMessagesQueued: await enqueueDueAutomations(sql)
  }));
  const counts = { sent: 0, retried: 0, failed: 0, suppressed: 0 };
  let claimedCount = 0;
  const safeLimit = Math.max(1, Math.min(limit, 50));
  for (let index = 0; index < safeLimit; index += 1) {
    const [message] = await withDatabaseRequestContext("service", {}, (sql) => claimDueMessages(sql, workerId, 1));
    if (!message) break;
    claimedCount += 1;
    const result = await sendClaimedMessage(message);
    if (result === "sent") counts.sent += 1;
    else if (result === "retry") counts.retried += 1;
    else if (result === "failed") counts.failed += 1;
    else if (result === "suppressed") counts.suppressed += 1;
  }
  const campaignsCompleted = await withDatabaseRequestContext("service", {}, reconcileCampaigns);
  return {
    ...prepared,
    claimed: claimedCount,
    ...counts,
    campaignsCompleted
  };
}
