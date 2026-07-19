import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cronRoute = await readFile(
  new URL("../src/app/api/cron/email-dispatch/route.ts", import.meta.url),
  "utf8"
);
const webhookRoute = await readFile(
  new URL("../src/app/api/webhooks/resend/route.ts", import.meta.url),
  "utf8"
);
const webhook = await readFile(new URL("../src/lib/email/webhooks.ts", import.meta.url), "utf8");
const unsubscribeRoute = await readFile(
  new URL("../src/app/api/unsubscribe/route.ts", import.meta.url),
  "utf8"
);
const unsubscribe = await readFile(new URL("../src/lib/email/unsubscribe.ts", import.meta.url), "utf8");
const resendClient = await readFile(
  new URL("../src/lib/email/resend-client.ts", import.meta.url),
  "utf8"
);
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("the email cron is private, fail-closed and explicitly based under backoffice", () => {
  assert.match(cronRoute, /timingSafeEqual/);
  assert.match(cronRoute, /authorization, `Bearer \$\{secret\}`/);
  assert.match(cronRoute, /secret\.length < 32/);
  assert.match(cronRoute, /!inspectEmailRuntime\(\)\.ready/);
  assert.match(cronRoute, /dispatchEmailQueue\(25\)/);
  assert.match(cronRoute, /"Cache-Control": "no-store"/);
  assert.deepEqual(vercel.crons.map((cron) => cron.path), ["/backoffice/api/cron/email-dispatch"]);
  assert.deepEqual(vercel.crons.map((cron) => cron.schedule), ["0 9 * * *"]);
});

test("Resend webhooks verify the untouched bounded body before writing evidence", () => {
  assert.match(webhookRoute, /const MAX_WEBHOOK_BYTES = 256 \* 1024/);
  assert.match(webhookRoute, /request\.headers\.get\("svix-id"\)/);
  assert.match(webhookRoute, /request\.headers\.get\("svix-timestamp"\)/);
  assert.match(webhookRoute, /request\.headers\.get\("svix-signature"\)/);
  assert.match(webhookRoute, /const payload = await request\.text\(\)/);
  assert.doesNotMatch(webhookRoute, /request\.json\(\)/);
  assert.match(webhookRoute, /Buffer\.byteLength\(payload, "utf8"\) > MAX_WEBHOOK_BYTES/);

  const verifyAt = webhook.indexOf("verifyResendWebhook(payload, headers)");
  const databaseAt = webhook.indexOf('withDatabaseRequestContext("service"');
  assert.ok(verifyAt >= 0 && databaseAt > verifyAt);
  assert.match(webhook, /const webhookSecret = requireEnv\("RESEND_WEBHOOK_SECRET"\)/);
  assert.match(webhook, /error\.name === "WebhookVerificationError"/);
  assert.match(webhookRoute, /ResendWebhookVerificationError/);
  assert.match(webhook, /signature_verified, payload_hash/);
  assert.match(webhook, /ON CONFLICT \(provider, provider_event_id\) DO NOTHING/);
});

test("delivery events are deduplicated, ordered and linked without retaining raw webhook bodies", () => {
  assert.match(webhook, /INSERT INTO pixbrik\.email_delivery_event/);
  assert.match(webhook, /provider_message_id = \$\{event\.data\.email_id\}/);
  assert.match(webhook, /pixbrik_message/);
  assert.match(webhook, /target_rank > current_rank/);
  assert.match(webhook, /eventCreatedAt\} >= last_provider_event_at/);
  assert.match(webhook, /last_provider_event_at IS NULL/);
  assert.match(webhook, /WHEN NOT projected\.transition_applied THEN message\.failure_summary/);
  assert.match(webhook, /ELSE NULL[\s\S]*next_attempt_at/);
  assert.match(webhook, /greatest\(coalesce\(message\.last_provider_event_at/);
  assert.match(webhook, /recovery_email_sent_at = coalesce\(recovery_email_sent_at/);
  assert.match(webhook, /event\.type !== "email\.received"/);
  assert.match(webhook, /record_email_suppression/);
  assert.match(webhook, /"hard_bounce" \| "complaint" \| "provider_suppressed" \| null/);
  assert.doesNotMatch(webhook, /INSERT INTO pixbrik\.email_delivery_event[\s\S]*?\$\{payload\}::jsonb/);
  assert.doesNotMatch(webhook, /ip_address|click_url|user_agent/i);
});

test("unsubscribe is a narrow idempotent service operation and never exposes a full address", () => {
  assert.match(unsubscribeRoute, /validUnsubscribeToken\(token\)/);
  assert.match(unsubscribeRoute, /unsubscribeMarketing\(token, "rfc8058\.one_click"\)/);
  assert.match(unsubscribeRoute, /"Cache-Control": "no-store"/);
  assert.match(unsubscribe, /UUID_PATTERN\.test\(token\)/);
  assert.match(unsubscribe, /withDatabaseRequestContext\("service", \{\}/);
  assert.match(unsubscribe, /pixbrik\.unsubscribe_marketing_contact/);
  assert.match(unsubscribe, /randomUUID\(\)/);
  assert.match(unsubscribe, /maskedEmail: mask\(contact\.email\)/);
  assert.doesNotMatch(unsubscribe, /DELETE FROM pixbrik\./);
});

test("runtime readiness requires every sender, webhook, public URL and cron boundary", () => {
  for (const key of [
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "RESEND_FROM_EMAIL",
    "RESEND_REPLY_TO_EMAIL",
    "CUSTOMER_APP_URL",
    "PUBLIC_EMAIL_APP_URL",
    "CRON_SECRET",
    "EMAIL_DELIVERY_APPROVED"
  ]) {
    assert.ok(resendClient.includes(`"${key}"`));
  }
  assert.match(resendClient, /parsed\.protocol === "https:"/);
  assert.match(resendClient, /pathOrUrl\.startsWith\("\/\/"\)/);
  assert.match(resendClient, /candidate\.origin !== expected/);
  assert.match(resendClient, /PUBLIC_EMAIL_APP_URL must use HTTPS in production/);
});
