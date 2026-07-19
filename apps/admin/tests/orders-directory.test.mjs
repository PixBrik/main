import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const orderData = await readFile(new URL("../src/lib/orders.ts", import.meta.url), "utf8");
const orderPage = await readFile(
  new URL("../src/app/(admin)/orders/page.tsx", import.meta.url),
  "utf8"
);

test("the order directory requires order access and uses the scoped database context", () => {
  assert.match(orderPage, /requirePermission\("orders\.read"\)/);
  assert.match(orderPage, /loadOrderDirectory\(principal\.userId, filters\)/);
  assert.match(orderData, /withDatabaseRequestContext\("admin", \{ userId \}/);
  assert.match(orderData, /const PAGE_SIZE = 25/);
  assert.doesNotMatch(orderPage, /No production records yet|Connect PostgreSQL/);
});

test("order search and status inputs are normalized before reaching SQL", () => {
  assert.match(orderData, /value\("q"\)\.slice\(0, 120\)/);
  assert.match(orderData, /ORDER_STATUS_OPTIONS\.includes/);
  assert.match(orderData, /orders\.order_number ILIKE \$\{pattern\}/);
  assert.match(orderData, /orders\.customer_email ILIKE \$\{pattern\}/);
  assert.match(orderData, /orders\.status::text = \$\{filters\.status\}/);
  assert.match(orderPage, /Order number or customer email/);
  assert.match(orderPage, /ORDER_STATUS_OPTIONS\.map/);
});

test("pagination is bounded to a database timestamp and has a deterministic tie breaker", () => {
  assert.match(orderData, /LEAST\(now\(\), coalesce\(\$\{filters\.snapshot\}::timestamptz, now\(\)\)\)/);
  assert.ok((orderData.match(/orders\.created_at <= \$\{snapshot\}::timestamptz/g) ?? []).length >= 3);
  assert.match(orderData, /ORDER BY orders\.created_at DESC, orders\.id DESC/);
  assert.match(orderData, /LIMIT \$\{PAGE_SIZE\} OFFSET \$\{offset\}/);
  assert.match(orderData, /Math\.min\(filters\.page, totalPages\)/);
  assert.match(orderPage, /params = new URLSearchParams\(\{ snapshot \}\)/);
  assert.match(orderPage, /Page \{directory\.page\} of \{directory\.totalPages\}/);
});

test("each order can reach its support workspace and exposes operational context", () => {
  assert.match(orderPage, /href=\{orderDetailRoute\(order\.id\)\}/);
  assert.match(orderPage, /href=\{customerDetailRoute\(order\.customerUserId\)\}/);
  for (const label of ["Needs action", "In fulfilment", "Net settled value", "Order records"]) {
    assert.ok(orderPage.includes(label));
  }
  assert.match(orderData, /FROM pixbrik\.payment_transaction payment/);
  assert.match(orderData, /payment\.kind IN \('refund', 'credit', 'chargeback'\)/);
  assert.match(orderData, /FROM pixbrik\.order_item item WHERE item\.order_id = orders\.id/);
});
