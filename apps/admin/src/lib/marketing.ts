import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";
import { parseEmailContentDefinition, type EmailPurpose } from "@/lib/email/email-template";
import {
  automationCapability,
  inspectEmailRuntime,
  type EmailRuntimeStatus
} from "@/lib/email/resend-client";

export type MarketingTemplate = Readonly<{
  id: string;
  key: string;
  locale: string;
  version: number;
  subject: string;
  previewText: string | null;
  purpose: EmailPurpose;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaPath: string;
}>;

export type MarketingTemplateFamily = Readonly<{
  key: string;
  version: number;
  purpose: EmailPurpose;
  variants: readonly MarketingTemplate[];
  preview: MarketingTemplate;
}>;

export type MarketingCampaign = Readonly<{
  id: string;
  name: string;
  templateKey: string;
  templateVersion: number;
  audienceKey: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  recipients: number;
  sent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  audienceEstimate: number;
  recipientCap: number | null;
}>;

export type MarketingAutomation = Readonly<{
  id: string;
  key: string;
  name: string;
  event: string;
  templateKey: string;
  templateVersion: number;
  enabled: boolean;
  delayMinutes: number;
  requiresConsent: boolean;
  enabledAt: string | null;
  capabilityReady: boolean;
  capabilityReason: string | null;
  updatedAt: string;
}>;

export type MarketingMessage = Readonly<{
  id: string;
  recipient: string;
  templateKey: string;
  kind: string;
  status: string;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
  failure: string | null;
}>;

export type MarketingContact = Readonly<{
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  status: string;
  customerAccount: boolean;
  consentAt: string | null;
  consentSource: string | null;
}>;

export type MarketingDashboard = Readonly<{
  runtime: EmailRuntimeStatus;
  summary: Readonly<{
    subscribed: number;
    campaigns: number;
    queued: number;
    failed: number;
    delivered30Days: number;
  }>;
  templates: readonly MarketingTemplateFamily[];
  contacts: readonly MarketingContact[];
  campaigns: readonly MarketingCampaign[];
  automations: readonly MarketingAutomation[];
  messages: readonly MarketingMessage[];
}>;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function number(value: string | number | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > 2 ? "***" : "*"}@${domain}`;
}

export async function loadMarketingDashboard(userId: string): Promise<MarketingDashboard> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [summary] = await sql<{
      subscribed: string;
      campaigns: string;
      queued: string;
      failed: string;
      delivered_30_days: string;
    }[]>`
      SELECT
        (SELECT count(*) FROM pixbrik.marketing_contact WHERE status = 'subscribed')::text AS subscribed,
        (SELECT count(*) FROM pixbrik.email_campaign)::text AS campaigns,
        (SELECT count(*) FROM pixbrik.outbound_message WHERE status IN ('queued', 'sending'))::text AS queued,
        (SELECT count(*) FROM pixbrik.outbound_message WHERE status = 'failed')::text AS failed,
        (SELECT count(*) FROM pixbrik.outbound_message
          WHERE delivered_at >= now() - interval '30 days')::text AS delivered_30_days
    `;

    const templateRows = await sql<{
      id: string;
      template_key: string;
      template_version: number;
      locale_code: string;
      version: number;
      subject: string;
      preview_text: string | null;
      content_definition: unknown;
    }[]>`
      SELECT DISTINCT ON (template_key, locale_code)
        id::text, template_key, locale_code, version, subject, preview_text, content_definition
      FROM pixbrik.communication_template
      WHERE status = 'approved'
      ORDER BY template_key, locale_code, version DESC
    `;

    const contacts = await sql<{
      id: string;
      email: string;
      display_name: string | null;
      locale_code: string;
      status: string;
      customer_user_id: string | null;
      consent_at: Date | string | null;
      consent_source: string | null;
    }[]>`
      SELECT id::text, email, display_name, locale_code, status,
        customer_user_id::text, consent_at, consent_source
      FROM pixbrik.marketing_contact
      ORDER BY updated_at DESC, id DESC
      LIMIT 100
    `;

    const campaigns = await sql<{
      id: string;
      name: string;
      template_key: string;
      template_version: number;
      audience_key: string;
      status: string;
      scheduled_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
      recipients: string;
      sent: string;
      delivered: string;
      failed: string;
      suppressed: string;
      audience_estimate: string;
      recipient_cap: number | null;
    }[]>`
      SELECT campaign.id::text, campaign.name, campaign.template_key,
        campaign.template_version, campaign.audience_key, campaign.status,
        campaign.scheduled_at, campaign.recipient_cap, campaign.created_at, campaign.updated_at,
        count(recipient.outbound_message_id)::text AS recipients,
        count(recipient.outbound_message_id) FILTER (WHERE message.status IN ('sent', 'delivered'))::text AS sent,
        count(recipient.outbound_message_id) FILTER (WHERE message.status = 'delivered')::text AS delivered,
        count(recipient.outbound_message_id) FILTER (WHERE message.status IN ('failed', 'bounced', 'complained'))::text AS failed,
        count(recipient.outbound_message_id) FILTER (WHERE message.status = 'suppressed')::text AS suppressed,
        (
          SELECT count(*)::text
          FROM pixbrik.marketing_contact contact
          WHERE contact.status = 'subscribed'
            AND (
              campaign.audience_key = 'all_subscribers'
              OR (campaign.audience_key = 'registered_customers' AND contact.customer_user_id IS NOT NULL)
              OR (campaign.audience_key = 'past_buyers' AND EXISTS (
                SELECT 1 FROM pixbrik.commerce_order orders
                WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
              ))
              OR (campaign.audience_key = 'no_orders' AND NOT EXISTS (
                SELECT 1 FROM pixbrik.commerce_order orders
                WHERE orders.customer_user_id = contact.customer_user_id AND orders.placed_at IS NOT NULL
              ))
            )
            AND NOT EXISTS (
              SELECT 1 FROM pixbrik.email_suppression suppression
              WHERE suppression.email = contact.email AND suppression.released_at IS NULL
            )
        ) AS audience_estimate
      FROM pixbrik.email_campaign campaign
      LEFT JOIN pixbrik.email_campaign_recipient recipient ON recipient.campaign_id = campaign.id
      LEFT JOIN pixbrik.outbound_message message ON message.id = recipient.outbound_message_id
      GROUP BY campaign.id
      ORDER BY campaign.created_at DESC
      LIMIT 50
    `;

    const automations = await sql<{
      id: string;
      rule_key: string;
      name: string;
      source_event: string;
      template_key: string;
      template_version: number;
      enabled: boolean;
      delay_minutes: number;
      requires_marketing_consent: boolean;
      enabled_at: Date | string | null;
      updated_at: Date | string;
    }[]>`
      SELECT id::text, rule_key, name, source_event, template_key, template_version, enabled,
        delay_minutes, requires_marketing_consent, enabled_at, updated_at
      FROM pixbrik.email_automation_rule
      ORDER BY source_event, rule_key
    `;

    const messages = await sql<{
      id: string;
      recipient: string;
      template_key: string;
      message_kind: string;
      status: string;
      attempt_count: number;
      scheduled_at: Date | string;
      sent_at: Date | string | null;
      failure_summary: string | null;
    }[]>`
      SELECT message.id::text, message.recipient, template.template_key,
        message.message_kind, message.status::text, message.attempt_count,
        message.scheduled_at, message.sent_at, message.failure_summary
      FROM pixbrik.outbound_message message
      JOIN pixbrik.communication_template template ON template.id = message.template_id
      ORDER BY message.created_at DESC
      LIMIT 75
    `;

    const templates = templateRows.map((row): MarketingTemplate => {
      const content = parseEmailContentDefinition(row.content_definition);
      return {
        id: row.id,
        key: row.template_key,
        locale: row.locale_code,
        version: row.version,
        subject: row.subject,
        previewText: row.preview_text,
        purpose: content.purpose,
        heading: content.heading,
        body: content.body,
        ctaLabel: content.ctaLabel,
        ctaPath: content.ctaPath
      };
    });
    const grouped = new Map<string, MarketingTemplate[]>();
    for (const template of templates) {
      const key = `${template.key}:${template.version}`;
      grouped.set(key, [...(grouped.get(key) ?? []), template]);
    }
    const families = [...grouped.values()].map((variants): MarketingTemplateFamily => {
      const preview = variants.find((variant) => variant.locale === "en") ?? variants[0];
      if (!preview) throw new Error("Template family has no variants");
      return {
        key: preview.key,
        version: preview.version,
        purpose: preview.purpose,
        variants: [...variants].sort((left, right) => left.locale.localeCompare(right.locale)),
        preview
      };
    }).sort((left, right) => left.key.localeCompare(right.key));

    return {
      runtime: inspectEmailRuntime(),
      summary: {
        subscribed: number(summary?.subscribed),
        campaigns: number(summary?.campaigns),
        queued: number(summary?.queued),
        failed: number(summary?.failed),
        delivered30Days: number(summary?.delivered_30_days)
      },
      templates: families,
      contacts: contacts.map((contact) => ({
        id: contact.id,
        email: maskEmail(contact.email),
        displayName: contact.display_name,
        locale: contact.locale_code,
        status: contact.status,
        customerAccount: Boolean(contact.customer_user_id),
        consentAt: iso(contact.consent_at),
        consentSource: contact.consent_source
      })),
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        templateKey: campaign.template_key,
        templateVersion: campaign.template_version,
        audienceKey: campaign.audience_key,
        status: campaign.status,
        scheduledAt: iso(campaign.scheduled_at),
        createdAt: iso(campaign.created_at) ?? new Date(0).toISOString(),
        updatedAt: iso(campaign.updated_at) ?? new Date(0).toISOString(),
        recipients: number(campaign.recipients),
        sent: number(campaign.sent),
        delivered: number(campaign.delivered),
        failed: number(campaign.failed)
        ,suppressed: number(campaign.suppressed)
        ,audienceEstimate: number(campaign.audience_estimate)
        ,recipientCap: campaign.recipient_cap
      })),
      automations: automations.map((automation) => {
        const capability = automationCapability(automation.source_event);
        return {
          id: automation.id,
          key: automation.rule_key,
          name: automation.name,
          event: automation.source_event,
          templateKey: automation.template_key,
          templateVersion: automation.template_version,
          enabled: automation.enabled,
          delayMinutes: automation.delay_minutes,
          requiresConsent: automation.requires_marketing_consent,
          enabledAt: iso(automation.enabled_at),
          capabilityReady: capability.ready,
          capabilityReason: capability.reason,
          updatedAt: iso(automation.updated_at) ?? new Date(0).toISOString()
        };
      }),
      messages: messages.map((message) => ({
        id: message.id,
        recipient: maskEmail(message.recipient),
        templateKey: message.template_key,
        kind: message.message_kind,
        status: message.status,
        attempts: message.attempt_count,
        scheduledAt: iso(message.scheduled_at) ?? new Date(0).toISOString(),
        sentAt: iso(message.sent_at),
        failure: message.failure_summary
      }))
    };
  });
}
