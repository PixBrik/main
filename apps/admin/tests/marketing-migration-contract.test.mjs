import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../migrations/0009_customer_marketing_operations.sql", import.meta.url),
  "utf8"
);

const marketingTables = [
  "marketing_contact",
  "marketing_consent_event",
  "email_suppression",
  "email_campaign",
  "email_automation_rule",
  "email_campaign_recipient",
  "email_delivery_event"
];

test("the customer marketing domain is migrator-owned and row-security forced", () => {
  assert.match(migration, /migration 0009 must run directly as pixbrik_migrator/);
  for (const table of marketingTables) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(migration, /\bGRANT\s[^;]*\bDELETE\b/i);
});

test("subscription can only exist with affirmative evidence and history is append-only", () => {
  assert.match(migration, /status <> 'subscribed'[\s\S]*consent_at IS NOT NULL[\s\S]*consent_source/);
  assert.match(migration, /marketing_consent_event_no_mutation[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(migration, /profile\.marketing_email_consent/);
  assert.match(migration, /profile\.marketing_consent_at IS NOT NULL/);
  assert.match(migration, /nullif\(btrim\(profile\.marketing_consent_source\), ''\) IS NOT NULL/);
  assert.match(migration, /Account creation or purchase never implies subscription|Subscription is never inferred from account creation or purchase/);
  assert.match(migration, /unsubscribe_marketing_contact[\s\S]*FOR UPDATE/);
  assert.match(migration, /INSERT INTO marketing_consent_event/);
});

test("campaigns, approved templates and attempted envelopes are immutable audit records", () => {
  assert.match(migration, /email campaigns are retained for audit/);
  assert.match(migration, /completed email campaigns are immutable/);
  assert.match(migration, /scheduled email campaign content and audience are immutable/);
  assert.match(migration, /approved or retired communication templates are retained for audit/);
  assert.match(migration, /approved communication template content is immutable/);
  assert.match(migration, /OLD\.status = 'approved' AND NEW\.status NOT IN \('approved', 'retired'\)/);
  assert.match(migration, /OLD\.status = 'retired' AND NEW\.status <> 'retired'/);
  assert.match(migration, /OLD\.attempt_count > 0/);
  assert.match(migration, /attempted outbound message envelope is immutable/);
  assert.match(migration, /envelope_sha256 text GENERATED ALWAYS/);
  assert.match(migration, /rendered outbound provider envelope is immutable/);
  assert.match(migration, /rendered_html_snapshot/);
  assert.match(migration, /email_delivery_event_no_mutation[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(migration, /email delivery event requires verified Resend webhook evidence/);
});

test("all lifecycle automations install disabled and consent-sensitive messages say so", () => {
  for (const rule of [
    /'welcome',[^\n]*'customer\.created',[^\n]*false, 0, false/,
    /'abandoned-checkout',[^\n]*'checkout\.abandoned',[^\n]*false, 60, true/,
    /'order-confirmation',[^\n]*'order\.placed',[^\n]*false, 0, false/,
    /'payment-failed',[^\n]*'payment\.failed',[^\n]*false, 5, false/,
    /'order-shipped',[^\n]*'order\.shipped',[^\n]*false, 0, false/,
    /'delivery-review',[^\n]*'order\.delivered',[^\n]*false, 10080, true/
  ]) {
    assert.match(migration, rule);
  }
});

test("every prebuilt email family is approved in every supported locale", () => {
  const keys = [
    "account.welcome",
    "checkout.abandoned",
    "order.confirmed",
    "payment.failed",
    "order.shipped",
    "review.request",
    "newsletter.gift_ideas",
    "newsletter.new_builds"
  ];
  for (const key of keys) {
    for (const locale of ["en", "fr", "es", "it", "ar"]) {
      const escaped = key.replaceAll(".", "\\.");
      assert.match(migration, new RegExp(`\\('${escaped}', '${locale}',`));
    }
  }
  assert.match(migration, /INSERT INTO communication_template[\s\S]*'approved'/);
  assert.match(migration, /ON CONFLICT \(template_key, locale_code, version\) DO NOTHING/);
});

test("service delivery privileges remain narrow and cover every worker read", () => {
  assert.match(migration, /REVOKE INSERT, UPDATE ON outbound_message FROM pixbrik_service_runtime/);
  assert.match(migration, /GRANT INSERT \([\s\S]*subject_snapshot, content_snapshot, next_attempt_at[\s\S]*ON outbound_message TO pixbrik_service_runtime/);
  assert.match(migration, /GRANT UPDATE \([\s\S]*lease_token, lease_expires_at, last_provider_event_at[\s\S]*ON outbound_message TO pixbrik_service_runtime/);
  assert.match(migration, /GRANT SELECT ON[\s\S]*outbound_message, communication_template, payment_transaction, order_event[\s\S]*TO pixbrik_service_runtime/);
  assert.match(migration, /REVOKE ALL ON FUNCTION unsubscribe_marketing_contact[\s\S]*FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION unsubscribe_marketing_contact[\s\S]*TO pixbrik_service_runtime/);
});
