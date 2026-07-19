import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;

export const ORDER_STATUS_OPTIONS = [
  "draft",
  "awaiting_design_approval",
  "awaiting_payment",
  "paid",
  "materials_reserved",
  "in_production",
  "quality_check",
  "ready_to_ship",
  "shipped",
  "delivered",
  "cancelled",
  "partially_refunded",
  "refunded",
  "disputed"
] as const;

export type OrderStatus = (typeof ORDER_STATUS_OPTIONS)[number];

export type OrderDirectoryFilters = Readonly<{
  query: string;
  status: "all" | OrderStatus;
  page: number;
  snapshot: string | null;
}>;

export type OrderDirectoryItem = Readonly<{
  id: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string | null;
  customerUserId: string | null;
  status: string;
  currency: string;
  totalPresentmentMinor: string;
  totalEurMinor: string;
  itemCount: number;
  placedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type OrderDirectory = Readonly<{
  summary: Readonly<{
    total: number;
    needsAction: number;
    inFulfilment: number;
    netSettledValueEurMinor: string;
  }>;
  items: readonly OrderDirectoryItem[];
  totalMatches: number;
  page: number;
  pageSize: number;
  totalPages: number;
  snapshot: string;
}>;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function number(value: string | number | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeOrderFilters(
  raw: Record<string, string | string[] | undefined>
): OrderDirectoryFilters {
  const value = (key: string): string => {
    const candidate = raw[key];
    return (Array.isArray(candidate) ? candidate[0] : candidate)?.trim() ?? "";
  };
  const statusValue = value("status");
  const pageValue = Number.parseInt(value("page"), 10);
  const snapshotValue = value("snapshot");
  const parsedSnapshot = snapshotValue ? new Date(snapshotValue) : null;
  return {
    query: value("q").slice(0, 120),
    status: statusValue === "all" || ORDER_STATUS_OPTIONS.includes(statusValue as OrderStatus)
      ? statusValue as OrderDirectoryFilters["status"]
      : "all",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10_000) : 1,
    snapshot: parsedSnapshot && !Number.isNaN(parsedSnapshot.getTime())
      ? parsedSnapshot.toISOString()
      : null
  };
}

export async function loadOrderDirectory(
  userId: string,
  filters: OrderDirectoryFilters
): Promise<OrderDirectory> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [clock] = await sql<{ snapshot: Date | string }[]>`
      SELECT LEAST(now(), coalesce(${filters.snapshot}::timestamptz, now())) AS snapshot
    `;
    const snapshot = iso(clock?.snapshot ?? new Date()) ?? new Date().toISOString();

    const [summary] = await sql<{
      total: string;
      needs_action: string;
      in_fulfilment: string;
      net_settled_value_eur_minor: string;
    }[]>`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE orders.status IN (
          'awaiting_design_approval', 'awaiting_payment', 'disputed'
        ))::text AS needs_action,
        count(*) FILTER (WHERE orders.status IN (
          'paid', 'materials_reserved', 'in_production', 'quality_check', 'ready_to_ship'
        ))::text AS in_fulfilment,
        (
          SELECT coalesce(sum(
            CASE
              WHEN payment.status = 'succeeded' AND (
                payment.kind = 'capture'
                OR (payment.kind = 'payment' AND NOT EXISTS (
                  SELECT 1
                  FROM pixbrik.payment_transaction settled_capture
                  WHERE settled_capture.provider = payment.provider
                    AND settled_capture.provider_payment_id = payment.provider_payment_id
                    AND settled_capture.kind = 'capture'
                    AND settled_capture.status = 'succeeded'
                    AND settled_capture.created_at <= ${snapshot}::timestamptz
                ))
              ) THEN payment.amount_eur_minor
              WHEN payment.status = 'succeeded'
                AND payment.kind IN ('refund', 'credit', 'chargeback')
                THEN -payment.amount_eur_minor
              ELSE 0
            END
          ), 0)::text
          FROM pixbrik.payment_transaction payment
          WHERE payment.created_at <= ${snapshot}::timestamptz
        ) AS net_settled_value_eur_minor
      FROM pixbrik.commerce_order orders
      WHERE orders.created_at <= ${snapshot}::timestamptz
    `;

    const pattern = `%${filters.query}%`;
    const [matchCount] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pixbrik.commerce_order orders
      WHERE orders.created_at <= ${snapshot}::timestamptz
        AND (${filters.query === ""} OR orders.order_number ILIKE ${pattern}
          OR orders.customer_email ILIKE ${pattern})
        AND (${filters.status === "all"} OR orders.status::text = ${filters.status})
    `;
    const totalMatches = number(matchCount?.count);
    const totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));
    const page = Math.min(filters.page, totalPages);
    const offset = (page - 1) * PAGE_SIZE;

    const rows = await sql<{
      id: string;
      order_number: string;
      customer_email: string;
      customer_name: string | null;
      customer_user_id: string | null;
      status: string;
      presentment_currency: string;
      total_presentment_minor: string;
      total_eur_minor: string;
      item_count: string;
      placed_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }[]>`
      SELECT orders.id::text, orders.order_number, orders.customer_email,
        account.display_name AS customer_name, orders.customer_user_id::text,
        orders.status::text, orders.presentment_currency,
        orders.total_presentment_minor::text, orders.total_eur_minor::text,
        (SELECT coalesce(sum(item.quantity), 0)
          FROM pixbrik.order_item item WHERE item.order_id = orders.id)::text AS item_count,
        orders.placed_at, orders.created_at, orders.updated_at
      FROM pixbrik.commerce_order orders
      LEFT JOIN pixbrik.app_user account ON account.id = orders.customer_user_id
      WHERE orders.created_at <= ${snapshot}::timestamptz
        AND (${filters.query === ""} OR orders.order_number ILIKE ${pattern}
          OR orders.customer_email ILIKE ${pattern})
        AND (${filters.status === "all"} OR orders.status::text = ${filters.status})
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

    return {
      summary: {
        total: number(summary?.total),
        needsAction: number(summary?.needs_action),
        inFulfilment: number(summary?.in_fulfilment),
        netSettledValueEurMinor: summary?.net_settled_value_eur_minor ?? "0"
      },
      items: rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        customerEmail: row.customer_email,
        customerName: row.customer_name,
        customerUserId: row.customer_user_id,
        status: row.status,
        currency: row.presentment_currency,
        totalPresentmentMinor: row.total_presentment_minor,
        totalEurMinor: row.total_eur_minor,
        itemCount: number(row.item_count),
        placedAt: iso(row.placed_at),
        createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
        updatedAt: iso(row.updated_at) ?? new Date(0).toISOString()
      })),
      totalMatches,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
      snapshot
    };
  });
}

export type OrderDetail = Readonly<{
  order: Readonly<{
    id: string;
    orderNumber: string;
    customerUserId: string | null;
    customerEmail: string;
    status: string;
    locale: string;
    currency: string;
    subtotalPresentmentMinor: string;
    discountPresentmentMinor: string;
    shippingPresentmentMinor: string;
    taxPresentmentMinor: string;
    totalPresentmentMinor: string;
    totalEurMinor: string;
    taxStatus: string;
    marketName: string | null;
    placedAt: string | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  items: readonly Readonly<{
    id: string;
    title: string;
    quantity: number;
    unitPricePresentmentMinor: string;
    productType: string | null;
    configuration: unknown;
  }>[];
  events: readonly Readonly<{
    id: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    occurredAt: string;
  }>[];
  payments: readonly Readonly<{
    id: string;
    kind: string;
    status: string;
    amountMinor: string;
    currency: string;
    createdAt: string;
  }>[];
  invoices: readonly Readonly<{
    id: string;
    number: string;
    kind: string;
    status: string;
    issuedAt: string | null;
  }>[];
}>;

export async function loadOrderDetail(userId: string, orderId: string): Promise<OrderDetail | null> {
  if (!UUID_PATTERN.test(orderId)) return null;
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [order] = await sql<{
      id: string;
      order_number: string;
      customer_user_id: string | null;
      customer_email: string;
      status: string;
      locale_code: string;
      presentment_currency: string;
      subtotal_presentment_minor: string;
      discount_presentment_minor: string;
      shipping_presentment_minor: string;
      tax_presentment_minor: string;
      total_presentment_minor: string;
      total_eur_minor: string;
      tax_calculation_status: string;
      market_name: string | null;
      placed_at: Date | string | null;
      paid_at: Date | string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }[]>`
      SELECT orders.id::text, orders.order_number, orders.customer_user_id::text,
        orders.customer_email, orders.status::text, orders.locale_code,
        orders.presentment_currency, orders.subtotal_presentment_minor::text,
        orders.discount_presentment_minor::text, orders.shipping_presentment_minor::text,
        orders.tax_presentment_minor::text, orders.total_presentment_minor::text,
        orders.total_eur_minor::text, orders.tax_calculation_status,
        market.name AS market_name, orders.placed_at, orders.paid_at,
        orders.created_at, orders.updated_at
      FROM pixbrik.commerce_order orders
      LEFT JOIN pixbrik.market market ON market.id = orders.market_id
      WHERE orders.id = ${orderId}::uuid
      LIMIT 1
    `;
    if (!order) return null;

    const [items, events, payments, invoices] = await Promise.all([
      sql<{
        id: string;
        title_snapshot: string;
        quantity: number;
        unit_price_presentment_minor: string;
        product_type: string | null;
        configuration_snapshot: unknown;
      }[]>`
        SELECT id::text, title_snapshot, quantity, unit_price_presentment_minor::text,
          product_type, configuration_snapshot
        FROM pixbrik.order_item
        WHERE order_id = ${orderId}::uuid
        ORDER BY created_at, id
      `,
      sql<{
        id: string;
        event_type: string;
        from_status: string | null;
        to_status: string | null;
        note: string | null;
        occurred_at: Date | string;
      }[]>`
        SELECT id::text, event_type, from_status::text, to_status::text, note, occurred_at
        FROM pixbrik.order_event
        WHERE order_id = ${orderId}::uuid
        ORDER BY occurred_at DESC, id DESC
      `,
      sql<{
        id: string;
        kind: string;
        status: string;
        amount_presentment_minor: string;
        presentment_currency: string;
        created_at: Date | string;
      }[]>`
        SELECT id::text, kind, status::text, amount_presentment_minor::text,
          presentment_currency, created_at
        FROM pixbrik.payment_transaction
        WHERE order_id = ${orderId}::uuid
        ORDER BY created_at DESC, id DESC
      `,
      sql<{
        id: string;
        invoice_number: string;
        kind: string;
        status: string;
        issued_at: Date | string | null;
      }[]>`
        SELECT id::text, invoice_number, kind, status, issued_at
        FROM pixbrik.invoice_document
        WHERE order_id = ${orderId}::uuid
        ORDER BY created_at DESC, id DESC
      `
    ]);

    return {
      order: {
        id: order.id,
        orderNumber: order.order_number,
        customerUserId: order.customer_user_id,
        customerEmail: order.customer_email,
        status: order.status,
        locale: order.locale_code,
        currency: order.presentment_currency,
        subtotalPresentmentMinor: order.subtotal_presentment_minor,
        discountPresentmentMinor: order.discount_presentment_minor,
        shippingPresentmentMinor: order.shipping_presentment_minor,
        taxPresentmentMinor: order.tax_presentment_minor,
        totalPresentmentMinor: order.total_presentment_minor,
        totalEurMinor: order.total_eur_minor,
        taxStatus: order.tax_calculation_status,
        marketName: order.market_name,
        placedAt: iso(order.placed_at),
        paidAt: iso(order.paid_at),
        createdAt: iso(order.created_at) ?? new Date(0).toISOString(),
        updatedAt: iso(order.updated_at) ?? new Date(0).toISOString()
      },
      items: items.map((item) => ({
        id: item.id,
        title: item.title_snapshot,
        quantity: item.quantity,
        unitPricePresentmentMinor: item.unit_price_presentment_minor,
        productType: item.product_type,
        configuration: item.configuration_snapshot
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        note: event.note,
        occurredAt: iso(event.occurred_at) ?? new Date(0).toISOString()
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        status: payment.status,
        amountMinor: payment.amount_presentment_minor,
        currency: payment.presentment_currency,
        createdAt: iso(payment.created_at) ?? new Date(0).toISOString()
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.invoice_number,
        kind: invoice.kind,
        status: invoice.status,
        issuedAt: iso(invoice.issued_at)
      }))
    };
  });
}
