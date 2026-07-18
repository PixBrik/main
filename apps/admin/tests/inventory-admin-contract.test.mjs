import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actions = await readFile(
  new URL("../src/app/(admin)/inventory/actions.ts", import.meta.url),
  "utf8"
);
const page = await readFile(
  new URL("../src/app/(admin)/inventory/page.tsx", import.meta.url),
  "utf8"
);
const inventory = await readFile(
  new URL("../src/lib/inventory.ts", import.meta.url),
  "utf8"
);

test("inventory has a dedicated actionable admin route", () => {
  assert.match(page, /requirePermission\("inventory\.read"\)/);
  assert.match(page, /hasPermission\(principal, "inventory\.manage"\)/);
  assert.match(page, /CreateInventoryItemForm/);
  assert.match(page, /CreateInventoryLocationForm/);
  assert.match(page, /AdjustInventoryStockForm/);
  assert.match(page, /href="#record-stock"/);
});

test("inventory mutations require management permission and trusted same-origin requests", () => {
  assert.equal((actions.match(/requirePermission\("inventory\.manage"\)/g) ?? []).length, 3);
  assert.equal((actions.match(/requireTrustedMutation\(\)/g) ?? []).length, 3);
  assert.match(actions, /withDatabaseRequestContext\("admin", \{ userId: principal\.userId \}/);
});

test("stock changes append a movement and never update balances directly", () => {
  assert.match(actions, /INSERT INTO pixbrik\.inventory_movement/);
  assert.match(actions, /idempotencyKey/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /already recorded; no duplicate was created/);
  assert.match(actions, /actor_user_id/);
  assert.match(actions, /inventory\.stock_adjusted/);
  assert.doesNotMatch(actions, /UPDATE pixbrik\.inventory_balance/);
  assert.doesNotMatch(actions, /INSERT INTO pixbrik\.inventory_balance/);
});

test("inventory reads expose catalog, per-location balances and ledger history", () => {
  assert.match(inventory, /FROM pixbrik\.inventory_catalog_item item/);
  assert.match(inventory, /FROM pixbrik\.inventory_balance balance/);
  assert.match(inventory, /FROM pixbrik\.inventory_movement movement/);
  assert.match(inventory, /item\.sku ILIKE/);
  assert.match(inventory, /low_stock_count/);
  assert.match(inventory, /search_location\.name ILIKE/);
});
