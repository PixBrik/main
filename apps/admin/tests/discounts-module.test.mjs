import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/app/(admin)/discounts/page.tsx", import.meta.url),
  "utf8"
);
const actions = await readFile(
  new URL("../src/app/(admin)/discounts/actions.ts", import.meta.url),
  "utf8"
);
const data = await readFile(new URL("../src/lib/discounts.ts", import.meta.url), "utf8");

test("discounts has a real database-backed route with honest empty state", () => {
  assert.match(page, /requirePermission\("discounts\.read"\)/);
  assert.match(page, /loadDiscountDashboard\(principal\.userId\)/);
  assert.match(page, /No discount codes yet/);
  assert.doesNotMatch(page, /Connect PostgreSQL|No production records yet/);
  assert.match(data, /FROM pixbrik\.coupon AS coupon/);
  assert.match(data, /pixbrik\.coupon_redemption/);
});

test("discount mutations enforce permission, same-origin trust, database role and audit", () => {
  assert.equal((actions.match(/requirePermission\("discounts\.manage"\)/g) ?? []).length, 2);
  assert.equal((actions.match(/requireTrustedMutation\(\)/g) ?? []).length, 2);
  assert.match(actions, /withDatabaseRequestContext\("admin", \{ userId: principal\.userId \}/);
  assert.match(actions, /INSERT INTO pixbrik\.audit_event/);
  assert.match(actions, /coupon\.created/);
  assert.match(actions, /coupon\.enabled/);
  assert.match(actions, /coupon\.disabled/);
  assert.doesNotMatch(actions, /DELETE FROM pixbrik\.coupon/);
});

test("discount creation supports percentage and fixed EUR limits", () => {
  assert.match(actions, /kind !== "percentage" && kind !== "fixed_eur"/);
  assert.match(actions, /maxRedemptionsPerCustomer/);
  assert.match(actions, /minimumSubtotalEurMinor/);
  assert.match(actions, /endsAt <= startsAt/);
  assert.match(actions, /Per-customer limit cannot exceed the total limit/);
});
