import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const core = await readFile(new URL("../migrations/0001_commerce_core.sql", import.meta.url), "utf8");
const seed = await readFile(new URL("../migrations/0002_launch_configuration.sql", import.meta.url), "utf8");
const operations = await readFile(new URL("../migrations/0004_operations_domains.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../migrations/0005_security_hardening.sql", import.meta.url), "utf8");

test("commerce schema contains the required versioned domains", () => {
  for (const table of [
    "app_user",
    "role",
    "permission",
    "shipping_zone",
    "shipping_rate",
    "fx_rate",
    "build_version",
    "commerce_order",
    "order_item",
    "coupon",
    "coupon_redemption",
    "checkout_recovery",
    "contact_submission",
    "outbound_message",
    "audit_event"
  ]) {
    assert.match(core, new RegExp(`CREATE TABLE ${table} \\(`));
  }
});

test("builds, invoices and audit history have database immutability guards", () => {
  assert.match(core, /prevent_locked_build_version_mutation/);
  assert.match(core, /locked build versions are immutable/);
  assert.match(core, /order items require a locked approved build version/);
  assert.match(core, /placed order commercial snapshots are immutable/);
  assert.match(core, /prevent_issued_invoice_mutation/);
  assert.match(core, /audit_event_no_update BEFORE UPDATE OR DELETE/);
  assert.match(core, /order_event_no_update BEFORE UPDATE OR DELETE/);
  assert.match(hardening, /placed order line items are immutable/);
  assert.match(hardening, /order_item_placed_order_lock/);
});

test("shipping and coupon concurrency invariants are enforced in PostgreSQL", () => {
  assert.match(core, /UNIQUE NULLS NOT DISTINCT \(zone_id, origin_id/);
  assert.match(core, /shipping rate overlaps an enabled rate/);
  assert.match(core, /pg_advisory_xact_lock/);
  assert.match(core, /coupon redemption limit reached/);
  assert.match(core, /coupon customer redemption limit reached/);
  assert.match(core, /percentage_basis_points IS NOT NULL/);
  assert.match(core, /fixed_amount_eur_minor IS NOT NULL/);
});

test("only approved effective legal versions can be accepted", () => {
  assert.match(core, /status = 'draft' OR \(approved_by IS NOT NULL AND approved_at IS NOT NULL\)/);
  assert.match(core, /legal acceptance requires an effective approved document version/);
  assert.match(core, /approved legal document content is immutable/);
  assert.match(hardening, /NEW\.product_types IS DISTINCT FROM OLD\.product_types/);
  assert.match(hardening, /legal acceptance user must own the referenced order/);
  assert.match(hardening, /document\.locale_code = accepted_order\.locale_code/);
  assert.match(hardening, /accepted_market\.code = ANY\(document\.markets\)/);
  assert.match(hardening, /item\.product_type IS NULL/);
  assert.match(hardening, /legal document must cover the order market and every product type/);
  assert.match(hardening, /ALTER TABLE legal_document ALTER COLUMN product_types DROP DEFAULT/);
  assert.match(hardening, /legal_acceptance_no_mutation/);
  assert.match(hardening, /BEFORE UPDATE OR DELETE ON legal_acceptance/);
  assert.doesNotMatch(hardening, /legal_acceptance_customer_insert/);
});

test("money snapshots retain EUR and presentment values plus the applied FX rate", () => {
  assert.match(core, /fx_rate_snapshot numeric\(24, 12\) NOT NULL/);
  assert.match(core, /total_eur_minor bigint NOT NULL/);
  assert.match(core, /total_presentment_minor bigint NOT NULL/);
  assert.match(core, /fx_effective_date date NOT NULL/);
});

test("launch seed contains requested markets but no guessed tax or shipping prices", () => {
  for (const market of ["European Union", "United Kingdom", "United States", "Canada", "Australia", "Middle East"]) {
    assert.ok(seed.includes(market));
  }
  assert.equal(/INSERT INTO shipping_rate/i.test(seed), false);
  assert.equal(/INSERT INTO legal_document/i.test(seed), false);
  assert.equal(/tax[_ ]rate[^\n]*0\.20/i.test(seed), false);
});

test("Arabic, requested currencies and invited owner are seeded", () => {
  assert.match(seed, /\('ar', 'العربية', 'rtl'\)/);
  for (const currency of ["EUR", "GBP", "USD", "CAD", "AUD"]) assert.ok(seed.includes(`'${currency}'`));
  assert.ok(seed.includes("sam@benisty.ca"));
  assert.match(seed, /'staff', 'invited'/);
});

test("inventory, affiliates, page views and export jobs have first-class schemas", () => {
  for (const table of [
    "inventory_catalog_item",
    "inventory_balance",
    "inventory_movement",
    "inventory_reservation",
    "affiliate_partner",
    "affiliate_attribution",
    "affiliate_commission",
    "affiliate_payout_batch",
    "analytics_visitor",
    "analytics_session",
    "analytics_page_view",
    "data_export_job"
  ]) {
    assert.match(operations, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(operations, /Append-only inventory ledger/);
  assert.match(operations, /Raw IP addresses are deliberately not stored/);
  assert.match(operations, /commission_eur_minor bigint NOT NULL/);
});

test("legal applicability and contact privacy records are versioned without fake consent", () => {
  assert.match(operations, /product_types text\[\] NOT NULL/);
  assert.match(operations, /content_sha256 text GENERATED ALWAYS/);
  assert.match(operations, /interaction_kind IN \('acceptance', 'acknowledgement', 'presentation'\)/);
  assert.match(operations, /RENAME COLUMN privacy_consent_at TO privacy_notice_presented_at/);
  assert.match(operations, /privacy_notice_version text NOT NULL/);
});

test("inventory and affiliate cross-record facts are guarded", () => {
  assert.match(hardening, /inventory movement order item must belong to its order/);
  assert.match(hardening, /inventory reservation requires an order item belonging to its order/);
  assert.match(hardening, /payout line partner must match its commission/);
  assert.match(hardening, /non-draft affiliate payout lines are immutable/);
  assert.match(hardening, /affiliate payout batch totals must equal its lines/);
  assert.match(hardening, /invalid affiliate commission status transition/);
  assert.match(hardening, /invalid affiliate payout batch status transition/);
  assert.match(hardening, /presentment amount must match the frozen FX rate/);
});

test("database checkout remains blocked until normalized legal release scopes exist", () => {
  assert.match(hardening, /commerce_order_legal_release_gate/);
  assert.match(hardening, /checkout blocked: normalized approved legal release scope is not implemented/);
  assert.match(hardening, /OLD\.placed_at IS NULL AND OLD\.paid_at IS NULL/);
  assert.match(hardening, /NEW\.status NOT IN \('draft', 'awaiting_design_approval'\)/);
  assert.match(hardening, /NEW\.stripe_checkout_session_id IS NOT NULL/);
  assert.match(hardening, /NEW\.stripe_payment_intent_id IS NOT NULL/);
  assert.match(hardening, /payment transactions require an already placed order/);
  assert.match(hardening, /unsupported payment provider/);
  assert.match(hardening, /Stripe payment transactions require a verified webhook event/);
  assert.match(hardening, /provider webhook signed facts are immutable/);
  assert.match(
    hardening,
    /GRANT UPDATE \(processed_at, processing_status, error_summary\)[\s\S]*ON provider_webhook_event/
  );
  assert.match(hardening, /coupon redemption blocked: database eligibility evaluator is not implemented/);
});
