import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/app/(admin)/[section]/page.tsx", import.meta.url),
  "utf8"
);
const data = await readFile(
  new URL("../src/lib/admin/section-data.ts", import.meta.url),
  "utf8"
);

test("generic admin sections render live database snapshots instead of setup placeholders", () => {
  assert.match(page, /getSectionSnapshot\(sectionKey, principal\.userId\)/);
  assert.match(page, /Production data/);
  assert.doesNotMatch(page, /No production records yet|Connect PostgreSQL|Next increment/);
  assert.doesNotMatch(data, /No production records yet|Connect PostgreSQL|Next increment/);
});

test("generic section data uses the isolated admin database context", () => {
  assert.match(data, /withDatabaseRequestContext\("admin", \{ userId \}/);
  for (const table of [
    "commerce_order",
    "app_user",
    "build",
    "shipping_zone",
    "analytics_page_view",
    "app_setting"
  ]) {
    assert.match(data, new RegExp(`pixbrik\\.${table}`));
  }
  assert.match(data, /FROM pixbrik\.payment_transaction settled_capture/);
  assert.match(data, /settled_capture\.kind = 'capture'/);
  assert.match(data, /settled_capture\.status = 'succeeded'/);
  assert.doesNotMatch(data, /payment\.kind IN \('payment', 'capture'\)/);
});

test("specialized CRUD sections cannot fall back to the generic route", () => {
  assert.match(data, /GENERIC_SECTION_KEYS/);
  for (const section of ["customers", "inventory", "models", "discounts", "affiliates", "marketing"]) {
    assert.doesNotMatch(
      data.match(/GENERIC_SECTION_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "",
      new RegExp(`"${section}"`)
    );
  }
});
