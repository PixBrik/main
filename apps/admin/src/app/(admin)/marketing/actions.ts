"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { requirePermission } from "@/lib/auth";
import {
  requireTrustedMutation,
  UntrustedMutationError,
  type AuthRequestContext
} from "@/lib/auth/request-security";
import { withDatabaseRequestContext } from "@/lib/db";
import { automationCapability, inspectEmailRuntime } from "@/lib/email/resend-client";

export type MarketingActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
}>;

class MarketingValidationError extends Error {}
class StaleMarketingRecordError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_KEY_PATTERN = /^[a-z0-9._-]{3,100}$/;
const AUDIENCES = ["all_subscribers", "registered_customers", "past_buyers", "no_orders"] as const;

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function uuid(formData: FormData, key: string): string {
  const value = formString(formData, key);
  if (!UUID_PATTERN.test(value)) throw new MarketingValidationError("Invalid record identifier.");
  return value;
}

function expectedDate(formData: FormData): Date {
  const value = new Date(formString(formData, "expectedUpdatedAt"));
  if (Number.isNaN(value.getTime())) {
    throw new MarketingValidationError("Refresh the page before changing this record.");
  }
  return value;
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function actionError(error: unknown, fallback: string): MarketingActionState {
  if (error instanceof MarketingValidationError || error instanceof StaleMarketingRecordError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof UntrustedMutationError) {
    return { status: "error", message: "Your request could not be verified. Refresh and try again." };
  }
  if (databaseCode(error) === "23505") {
    return { status: "error", message: "That marketing record already exists." };
  }
  console.error("Marketing mutation failed", error);
  return { status: "error", message: fallback };
}

function refreshMarketing(): void {
  try {
    revalidatePath("/marketing");
  } catch {
    // A committed database mutation must not be reported as failed because cache refresh failed.
  }
}

async function audit(
  sql: TransactionSql,
  principal: Awaited<ReturnType<typeof requirePermission>>,
  request: AuthRequestContext,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
  permission: string
): Promise<void> {
  await sql`
    INSERT INTO pixbrik.audit_event (
      actor_user_id, actor_subject, action, target_type, target_id, request_id,
      ip_hash, user_agent, before_state, after_state, metadata
    ) VALUES (
      ${principal.userId}::uuid, ${principal.subject}, ${action}, ${targetType}, ${targetId},
      ${request.requestId}::uuid, ${request.ipDigest}, ${request.userAgentDigest},
      ${before === null ? null : JSON.stringify(before)}::jsonb,
      ${JSON.stringify(after)}::jsonb,
      ${JSON.stringify({ permission })}::jsonb
    )
  `;
}

export async function createCampaignAction(
  _previous: MarketingActionState,
  formData: FormData
): Promise<MarketingActionState> {
  const principal = await requirePermission("marketing.manage");
  try {
    const request = await requireTrustedMutation();
    const name = formString(formData, "name");
    const templateKey = formString(formData, "templateKey");
    const version = Number.parseInt(formString(formData, "templateVersion"), 10);
    const audienceKey = formString(formData, "audienceKey");
    if (name.length < 2 || name.length > 120) {
      throw new MarketingValidationError("Campaign name must be between 2 and 120 characters.");
    }
    if (!TEMPLATE_KEY_PATTERN.test(templateKey) || !Number.isSafeInteger(version) || version < 1) {
      throw new MarketingValidationError("Choose a valid approved newsletter template.");
    }
    if (!AUDIENCES.includes(audienceKey as (typeof AUDIENCES)[number])) {
      throw new MarketingValidationError("Choose a valid audience.");
    }

    let createdName = name;
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [templateCoverage] = await sql<{ locales: string }[]>`
        SELECT count(DISTINCT locale_code)::text AS locales
        FROM pixbrik.communication_template
        WHERE template_key = ${templateKey}
          AND version = ${version}
          AND status = 'approved'
          AND content_definition->>'purpose' = 'marketing'
      `;
      if (Number(templateCoverage?.locales ?? 0) !== 5) {
        throw new MarketingValidationError("This template is not approved in all five customer languages.");
      }
      const [created] = await sql<{
        id: string;
        name: string;
        template_key: string;
        template_version: number;
        audience_key: string;
        status: string;
        created_at: Date;
      }[]>`
        INSERT INTO pixbrik.email_campaign (
          name, template_key, template_version, audience_key, created_by, updated_by
        ) VALUES (
          ${name}, ${templateKey}, ${version}, ${audienceKey},
          ${principal.userId}::uuid, ${principal.userId}::uuid
        )
        RETURNING id::text, name, template_key, template_version, audience_key, status, created_at
      `;
      if (!created) throw new Error("Campaign insert returned no row");
      createdName = created.name;
      await audit(sql, principal, request, "email_campaign.created", "email_campaign", created.id, null, created, "marketing.manage");
    });
    refreshMarketing();
    return { status: "success", message: `${createdName} was created as a draft.` };
  } catch (error) {
    return actionError(error, "The campaign could not be created.");
  }
}

export async function changeCampaignStatusAction(
  _previous: MarketingActionState,
  formData: FormData
): Promise<MarketingActionState> {
  const principal = await requirePermission("marketing.send");
  try {
    const request = await requireTrustedMutation();
    const campaignId = uuid(formData, "campaignId");
    const expectedUpdatedAt = expectedDate(formData);
    const intent = formString(formData, "intent");
    if (intent !== "launch" && intent !== "schedule" && intent !== "cancel") {
      throw new MarketingValidationError("Invalid campaign action.");
    }
    if (intent !== "cancel" && !inspectEmailRuntime().ready) {
      throw new MarketingValidationError("Email sending is locked until every Resend, webhook, public URL and cron setting is configured.");
    }
    const audienceConfirmed = formString(formData, "confirmAudience") === "true";
    const expectedAudienceSize = Number.parseInt(formString(formData, "expectedAudienceSize"), 10);
    if (intent !== "cancel" && (!audienceConfirmed || !Number.isSafeInteger(expectedAudienceSize) || expectedAudienceSize < 1)) {
      throw new MarketingValidationError("Confirm the current recipient count before scheduling this campaign.");
    }
    let scheduledAt: Date | null = null;
    if (intent === "launch") scheduledAt = new Date();
    if (intent === "schedule") {
      const raw = formString(formData, "scheduledAt");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
        throw new MarketingValidationError("Choose a valid UTC schedule.");
      }
      const timezoneOffset = Number.parseInt(formString(formData, "timezoneOffset"), 10);
      if (!Number.isSafeInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) {
        throw new MarketingValidationError("The browser timezone could not be verified. Refresh and try again.");
      }
      const [datePart, timePart] = raw.split("T");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour, minute] = timePart.split(":").map(Number);
      scheduledAt = new Date(Date.UTC(year, month - 1, day, hour, minute) + timezoneOffset * 60_000);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
        throw new MarketingValidationError("The campaign schedule must be in the future.");
      }
      if (scheduledAt > new Date(Date.now() + 366 * 24 * 60 * 60 * 1_000)) {
        throw new MarketingValidationError("Campaigns can be scheduled up to one year ahead.");
      }
    }

    let campaignName = "Campaign";
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [before] = await sql<{
        id: string;
        name: string;
        status: string;
        audience_key: string;
        scheduled_at: Date | null;
        updated_at: Date;
      }[]>`
        SELECT id::text, name, status, audience_key, scheduled_at, updated_at
        FROM pixbrik.email_campaign
        WHERE id = ${campaignId}::uuid
        FOR UPDATE
      `;
      if (!before) throw new MarketingValidationError("Campaign not found.");
      campaignName = before.name;
      if (before.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        throw new StaleMarketingRecordError("This campaign changed in another session. Refresh and try again.");
      }
      if (intent === "cancel" && !["draft", "scheduled", "failed"].includes(before.status)) {
        throw new MarketingValidationError("Only a draft, scheduled or failed campaign can be cancelled.");
      }
      if (intent !== "cancel" && before.status !== "draft") {
        throw new MarketingValidationError("Only a draft campaign can be scheduled. Create a new campaign to retry a completed or failed send.");
      }
      let recipientCap: number | null = null;
      if (intent !== "cancel") {
        const [audience] = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM pixbrik.marketing_contact contact
          WHERE contact.status = 'subscribed'
            AND (
              ${before.audience_key} = 'all_subscribers'
              OR (${before.audience_key} = 'registered_customers' AND contact.customer_user_id IS NOT NULL)
              OR (${before.audience_key} = 'past_buyers' AND EXISTS (
                SELECT 1 FROM pixbrik.commerce_order orders
                WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
              ))
              OR (${before.audience_key} = 'no_orders' AND NOT EXISTS (
                SELECT 1 FROM pixbrik.commerce_order orders
                WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
              ))
            )
            AND NOT EXISTS (
              SELECT 1 FROM pixbrik.email_suppression suppression
              WHERE suppression.email = contact.email AND suppression.released_at IS NULL
            )
        `;
        recipientCap = Number(audience?.count ?? 0);
        if (recipientCap < 1) throw new MarketingValidationError("This audience has no currently subscribed recipients.");
        if (recipientCap !== expectedAudienceSize) {
          throw new StaleMarketingRecordError("The audience changed. Refresh, review the new recipient count, and confirm again.");
        }
      }
      const [after] = await sql<{
        id: string;
        name: string;
        status: string;
        scheduled_at: Date | null;
        updated_at: Date;
      }[]>`
        UPDATE pixbrik.email_campaign
        SET status = ${intent === "cancel" ? "cancelled" : "scheduled"},
          scheduled_at = CASE WHEN ${intent === "cancel"} THEN scheduled_at ELSE ${scheduledAt} END,
          recipient_cap = CASE WHEN ${intent === "cancel"} THEN recipient_cap ELSE ${recipientCap} END,
          updated_by = ${principal.userId}::uuid
        WHERE id = ${campaignId}::uuid
        RETURNING id::text, name, status, scheduled_at, updated_at
      `;
      if (!after) throw new Error("Campaign update returned no row");
      await audit(sql, principal, request, `email_campaign.${after.status}`, "email_campaign", after.id, before, after, "marketing.send");
    });
    refreshMarketing();
    return { status: "success", message: intent === "cancel" ? `${campaignName} was cancelled.` : `${campaignName} is scheduled.` };
  } catch (error) {
    return actionError(error, "The campaign status could not be changed.");
  }
}

export async function setAutomationEnabledAction(
  _previous: MarketingActionState,
  formData: FormData
): Promise<MarketingActionState> {
  const principal = await requirePermission("marketing.send");
  try {
    const request = await requireTrustedMutation();
    const ruleId = uuid(formData, "ruleId");
    const expectedUpdatedAt = expectedDate(formData);
    const enabledValue = formString(formData, "enabled");
    if (enabledValue !== "true" && enabledValue !== "false") {
      throw new MarketingValidationError("Invalid automation setting.");
    }
    const enabled = enabledValue === "true";
    if (enabled && !inspectEmailRuntime().ready) {
      throw new MarketingValidationError("Automations are locked until every Resend, webhook, public URL and cron setting is configured.");
    }
    let ruleName = "Automation";
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [before] = await sql<{
        id: string;
        name: string;
        enabled: boolean;
        template_key: string;
        template_version: number;
        source_event: string;
        requires_marketing_consent: boolean;
        enabled_at: Date | null;
        updated_at: Date;
      }[]>`
        SELECT id::text, name, enabled, template_key, template_version, source_event,
          requires_marketing_consent, enabled_at, updated_at
        FROM pixbrik.email_automation_rule
        WHERE id = ${ruleId}::uuid
        FOR UPDATE
      `;
      if (!before) throw new MarketingValidationError("Automation not found.");
      ruleName = before.name;
      if (before.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        throw new StaleMarketingRecordError("This automation changed in another session. Refresh and try again.");
      }
      if (enabled) {
        const capability = automationCapability(before.source_event);
        if (!capability.ready) throw new MarketingValidationError(capability.reason ?? "This automation capability is not ready.");
        const expectsMarketing = ["checkout.abandoned", "order.delivered"].includes(before.source_event);
        if (expectsMarketing !== before.requires_marketing_consent) {
          throw new MarketingValidationError("The automation consent policy does not match its lifecycle event.");
        }
        const [templateCoverage] = await sql<{ locales: string }[]>`
          SELECT count(DISTINCT locale_code)::text AS locales
          FROM pixbrik.communication_template
          WHERE template_key = ${before.template_key}
            AND version = ${before.template_version}
            AND status = 'approved'
            AND content_definition->>'purpose' = ${expectsMarketing ? "marketing" : "transactional"}
        `;
        if (Number(templateCoverage?.locales ?? 0) !== 5) {
          throw new MarketingValidationError("The automation template is not approved in all five customer languages.");
        }
      }
      const [after] = await sql<{
        id: string;
        name: string;
        enabled: boolean;
        enabled_at: Date | null;
        updated_at: Date;
      }[]>`
        UPDATE pixbrik.email_automation_rule
        SET enabled = ${enabled}, enabled_at = CASE WHEN ${enabled} THEN now() ELSE NULL END,
          updated_by = ${principal.userId}::uuid
        WHERE id = ${ruleId}::uuid
        RETURNING id::text, name, enabled, enabled_at, updated_at
      `;
      if (!after) throw new Error("Automation update returned no row");
      await audit(sql, principal, request, enabled ? "email_automation.enabled" : "email_automation.disabled", "email_automation_rule", after.id, before, after, "marketing.send");
    });
    refreshMarketing();
    return { status: "success", message: `${ruleName} was ${enabled ? "enabled" : "disabled"}.` };
  } catch (error) {
    return actionError(error, "The automation could not be changed.");
  }
}
