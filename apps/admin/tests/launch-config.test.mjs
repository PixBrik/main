import assert from "node:assert/strict";
import test from "node:test";

import { COMPLIANCE_GATES, LAUNCH_CONFIG } from "../src/lib/launch-config.ts";

test("launch configuration preserves the requested locales and EUR base", () => {
  assert.deepEqual(
    LAUNCH_CONFIG.locales.map((locale) => locale.code),
    ["en", "fr", "es", "it", "ar"]
  );
  assert.equal(LAUNCH_CONFIG.locales.find((locale) => locale.code === "ar")?.direction, "rtl");
  assert.equal(LAUNCH_CONFIG.baseCurrency, "EUR");
  assert.deepEqual(LAUNCH_CONFIG.presentmentCurrencies, ["EUR", "GBP", "USD", "CAD", "AUD"]);
  assert.equal(LAUNCH_CONFIG.ownerEmail, "sam@benisty.ca");
  assert.equal(LAUNCH_CONFIG.contactRecipient, "hello@pixbrik.com");
});

test("unreviewed compliance positions stay blocked", () => {
  assert.ok(COMPLIANCE_GATES.length >= 4);
  assert.ok(COMPLIANCE_GATES.every((gate) => gate.status === "blocked"));
});
