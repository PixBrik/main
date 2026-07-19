import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/app/(admin)/marketing/page.tsx", import.meta.url),
  "utf8"
);
const actions = await readFile(
  new URL("../src/app/(admin)/marketing/actions.ts", import.meta.url),
  "utf8"
);
const dashboard = await readFile(new URL("../src/lib/marketing.ts", import.meta.url), "utf8");
const outbox = await readFile(new URL("../src/lib/email/outbox.tsx", import.meta.url), "utf8");
const permissions = await readFile(new URL("../src/lib/permissions.ts", import.meta.url), "utf8");

test("marketing has a database-backed dashboard with prebuilt localized templates", () => {
  assert.match(page, /requirePermission\("marketing\.read"\)/);
  assert.match(page, /hasPermission\(principal, "marketing\.manage"\)/);
  assert.match(page, /hasPermission\(principal, "marketing\.send"\)/);
  assert.match(page, /family\.variants\.length === 5/);
  assert.match(page, /PixBrik email templates/);
  assert.match(page, /Newsletters/);
  assert.match(page, /Automated email rules/);
  assert.match(page, /Delivery queue/);
  assert.doesNotMatch(page, /No production records yet|Connect PostgreSQL/);

  assert.match(dashboard, /withDatabaseRequestContext\("admin", \{ userId \}/);
  for (const table of [
    "marketing_contact",
    "communication_template",
    "email_campaign",
    "email_automation_rule",
    "outbound_message"
  ]) {
    assert.match(dashboard, new RegExp(`pixbrik\\.${table}`));
  }
  assert.match(dashboard, /WHERE status = 'approved'/);
  assert.match(dashboard, /maskEmail\(message\.recipient\)/);
});

test("campaign and automation mutations separate manage from send authority", () => {
  assert.equal((actions.match(/requirePermission\("marketing\.manage"\)/g) ?? []).length, 1);
  assert.equal((actions.match(/requirePermission\("marketing\.send"\)/g) ?? []).length, 2);
  assert.equal((actions.match(/requireTrustedMutation\(\)/g) ?? []).length, 3);
  assert.match(actions, /withDatabaseRequestContext\("admin", \{ userId: principal\.userId \}/);
  assert.match(actions, /INSERT INTO pixbrik\.audit_event/);
  assert.match(actions, /email_campaign\.created/);
  assert.match(actions, /email_automation\.enabled/);
  assert.match(actions, /email_automation\.disabled/);
  assert.match(actions, /FROM pixbrik\.email_campaign[\s\S]*FOR UPDATE/);
  assert.match(actions, /before\.updated_at\.toISOString\(\) !== expectedUpdatedAt\.toISOString\(\)/);
  assert.doesNotMatch(actions, /DELETE FROM pixbrik\./);
  for (const permission of ["marketing.read", "marketing.manage", "marketing.send"]) {
    assert.ok(permissions.includes(`"${permission}"`));
  }
});

test("only approved five-language marketing templates can become newsletter campaigns", () => {
  assert.match(actions, /content_definition->>'purpose' = 'marketing'/);
  assert.match(actions, /status = 'approved'/);
  assert.match(actions, /Number\(templateCoverage\?\.locales \?\? 0\) !== 5/);
  for (const audience of ["all_subscribers", "registered_customers", "past_buyers", "no_orders"]) {
    assert.ok(actions.includes(`"${audience}"`));
  }
  assert.match(actions, /intent !== "cancel" && !inspectEmailRuntime\(\)\.ready/);
  assert.match(actions, /enabled && !inspectEmailRuntime\(\)\.ready/);
  assert.match(actions, /expectsMarketing !== before\.requires_marketing_consent/);
  assert.match(actions, /enabled_at = CASE WHEN \$\{enabled\} THEN now\(\) ELSE NULL END/);
  assert.match(actions, /automationCapability\(before\.source_event\)/);
});

test("the outbox derives lifecycle messages idempotently from authoritative records", () => {
  assert.match(outbox, /FROM pixbrik\.email_automation_rule[\s\S]*WHERE enabled/);
  for (const event of [
    "customer.created",
    "checkout.abandoned",
    "order.placed",
    "payment.failed",
    "order.shipped",
    "order.delivered"
  ]) {
    assert.ok(outbox.includes(`rule.source_event === "${event}"`));
  }
  assert.match(outbox, /recovery\.email_marketing_consent/);
  assert.match(outbox, /contact\.status = 'subscribed'/);
  assert.match(outbox, /contact\.status = 'subscribed'[\s\S]*email_suppression/);
  assert.match(outbox, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(outbox, /candidate\.status = 'approved'/);
  assert.match(outbox, /template\.subject, template\.content_definition/);
  assert.match(outbox, /account\.created_at >= \$\{rule\.enabled_at\}/);
  assert.match(outbox, /recovery\.abandoned_at >= \$\{rule\.enabled_at\}/);
  assert.match(outbox, /orders\.placed_at >= \$\{rule\.enabled_at\}/);
  assert.match(outbox, /payment\.created_at >= \$\{rule\.enabled_at\}/);
  assert.match(outbox, /source\.occurred_at >= \$\{rule\.enabled_at\}/);
});

test("campaign materialization respects consent, suppression and declared audience", () => {
  const materialize = outbox.slice(
    outbox.indexOf("async function materializeCampaigns"),
    outbox.indexOf("async function claimDueMessages")
  );
  assert.match(materialize, /FOR UPDATE SKIP LOCKED/);
  assert.match(materialize, /WHERE contact\.status = 'subscribed'/);
  assert.match(materialize, /suppression\.released_at IS NULL/);
  assert.match(materialize, /campaign\.audience_key === "all_subscribers"/);
  assert.match(materialize, /campaign\.audience_key === "registered_customers"/);
  assert.match(materialize, /campaign\.audience_key === "past_buyers"/);
  assert.match(materialize, /campaign\.audience_key === "no_orders"/);
  assert.match(materialize, /INSERT INTO pixbrik\.email_campaign_recipient/);
});

test("provider sends are leased, consent-checked again and fenced on completion", () => {
  assert.match(outbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(outbox, /lease_token = \$\{leaseToken\}::uuid/);
  assert.match(outbox, /lease_expires_at = now\(\) \+ interval '5 minutes'/);
  assert.match(outbox, /attempt_count < 5/);
  assert.match(outbox, /first_attempt_at < now\(\) - interval '23 hours'/);
  assert.match(outbox, /WHERE id = \$\{message\.id\}::uuid AND lease_token = \$\{message\.lease_token\}::uuid/);

  const send = outbox.slice(
    outbox.indexOf("async function sendClaimedMessage"),
    outbox.indexOf("async function reconcileCampaigns")
  );
  const suppressionCheck = send.indexOf("message.suppression_reason");
  const consentCheck = send.indexOf('message.message_kind === "marketing"');
  const providerSend = send.indexOf("emails.send");
  assert.ok(suppressionCheck >= 0 && suppressionCheck < providerSend);
  assert.ok(consentCheck >= 0 && consentCheck < providerSend);
  const envelopeFreeze = outbox.slice(
    outbox.indexOf("async function freezeProviderEnvelope"),
    outbox.indexOf("async function sendClaimedMessage")
  );
  assert.match(envelopeFreeze, /List-Unsubscribe/);
  assert.match(envelopeFreeze, /List-Unsubscribe-Post/);
  assert.match(send, /headers: envelope\.headers/);
  assert.match(send, /idempotencyKey: message\.idempotency_key/);
  assert.match(send, /parseEmailContentDefinition\(message\.content_snapshot\)/);
  assert.match(send, /Email purpose does not match message kind/);
  assert.match(send, /freezeProviderEnvelope\(message, content\)/);
  assert.ok(
    send.indexOf("providerEnvelope(message)") < send.indexOf("parseEmailContentDefinition(message.content_snapshot)"),
    "a retry must use its immutable rendered envelope before parsing mutable renderer inputs"
  );
  assert.match(send, /if \(!envelope\) \{[\s\S]*parseEmailContentDefinition/);
  assert.match(send, /html: envelope\.html/);
  assert.match(send, /text: envelope\.text/);
});
