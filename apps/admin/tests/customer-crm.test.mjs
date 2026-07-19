import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = await readFile(new URL("../src/lib/customers.ts", import.meta.url), "utf8");
const directoryPage = await readFile(
  new URL("../src/app/(admin)/customers/page.tsx", import.meta.url),
  "utf8"
);
const customerPage = await readFile(
  new URL("../src/app/(admin)/customers/[customerId]/page.tsx", import.meta.url),
  "utf8"
);
const orderData = await readFile(new URL("../src/lib/orders.ts", import.meta.url), "utf8");
const orderPage = await readFile(
  new URL("../src/app/(admin)/orders/[orderId]/page.tsx", import.meta.url),
  "utf8"
);
const routes = await readFile(new URL("../src/lib/routes.ts", import.meta.url), "utf8");

test("the customer directory is authorized, searchable and limited to customer accounts", () => {
  assert.match(directoryPage, /requirePermission\("customers\.read"\)/);
  assert.match(directoryPage, /normalizeCustomerFilters\(await searchParams\)/);
  assert.match(directoryPage, /loadCustomerDirectory\(principal\.userId, filters\)/);
  assert.match(directory, /withDatabaseRequestContext\("admin", \{ userId \}/);
  assert.match(directory, /const PAGE_SIZE = 25/);
  assert.match(directory, /value\("q"\)\.slice\(0, 120\)/);
  assert.match(directory, /account\.email ILIKE \$\{pattern\}/);
  assert.match(directory, /coalesce\(account\.display_name, ''\) ILIKE \$\{pattern\}/);
  assert.ok((directory.match(/account\.kind = 'customer'/g) ?? []).length >= 3);
  assert.match(directory, /LIMIT \$\{PAGE_SIZE\} OFFSET \$\{offset\}/);
  assert.match(directoryPage, /No customer accounts yet/);
  assert.doesNotMatch(directoryPage, /No production records yet|Connect PostgreSQL/);
});

test("customer value and purchase history are joined by immutable identity, never guessed from email", () => {
  assert.match(directory, /WHERE orders\.customer_user_id = account\.id/);
  assert.match(directory, /count\(\*\) FILTER \(WHERE orders\.placed_at IS NOT NULL\)/);
  assert.match(directory, /sum\(orders\.total_eur_minor\) FILTER \(WHERE orders\.placed_at IS NOT NULL\)/);
  assert.match(directory, /WHERE orders\.customer_user_id = \$\{customerId\}::uuid/);
  assert.match(directory, /WHERE user_id = \$\{customerId\}::uuid/);
  assert.match(directory, /WHERE message\.customer_user_id = \$\{customerId\}::uuid/);
  assert.match(directory, /WHERE contact\.customer_user_id = \$\{customerId\}::uuid/);
  assert.doesNotMatch(directory, /orders\.customer_email\s*=\s*account\.email/);
  assert.match(customerPage, /never by guessing from an email address/);
  assert.match(customerPage, /Account creation and purchasing never imply subscription/);
});

test("customer and order workspaces expose the records needed for support", () => {
  assert.match(customerPage, /requirePermission\("customers\.read"\)/);
  assert.match(customerPage, /loadCustomerDetail\(principal\.userId, customerId\)/);
  assert.match(customerPage, /if \(!detail\) notFound\(\)/);
  for (const label of ["Purchase history", "Saved destinations", "Email history", "Consent evidence"]) {
    assert.ok(customerPage.includes(label));
  }

  assert.match(orderPage, /requirePermission\("orders\.read"\)/);
  assert.match(orderPage, /loadOrderDetail\(principal\.userId, orderId\)/);
  for (const table of ["commerce_order", "order_item", "order_event", "payment_transaction", "invoice_document"]) {
    assert.match(orderData, new RegExp(`FROM pixbrik\\.${table}`));
  }
  assert.match(orderPage, /customerDetailRoute\(order\.customerUserId\)/);
  assert.match(routes, /export function customerDetailRoute/);
  assert.match(routes, /export function orderDetailRoute/);
});

test("detail loaders reject malformed identifiers before entering a database context", () => {
  const customerGuard = directory.indexOf("if (!UUID_PATTERN.test(customerId)) return null;");
  const customerContext = directory.indexOf('withDatabaseRequestContext("admin"', customerGuard);
  assert.ok(customerGuard >= 0 && customerContext > customerGuard);

  const orderGuard = orderData.indexOf("if (!UUID_PATTERN.test(orderId)) return null;");
  const orderContext = orderData.indexOf('withDatabaseRequestContext("admin"', orderGuard);
  assert.ok(orderGuard >= 0 && orderContext > orderGuard);
});
