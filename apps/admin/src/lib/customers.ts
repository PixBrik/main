import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";

export type CustomerDirectoryFilters = Readonly<{
  query: string;
  status: "all" | "invited" | "active" | "suspended" | "deleted";
  marketing: "all" | "subscribed" | "unsubscribed" | "suppressed" | "none";
  page: number;
}>;

export type CustomerDirectoryItem = Readonly<{
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  locale: string;
  currency: string;
  emailVerifiedAt: string | null;
  marketingStatus: string | null;
  placedOrders: number;
  placedValueEurMinor: string;
  lastOrderAt: string | null;
  createdAt: string;
}>;

export type CustomerDirectory = Readonly<{
  summary: Readonly<{
    total: number;
    active: number;
    buyers: number;
    subscribed: number;
  }>;
  items: readonly CustomerDirectoryItem[];
  totalMatches: number;
  page: number;
  pageSize: number;
  totalPages: number;
}>;

export type CustomerDetail = Readonly<{
  customer: Readonly<{
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    locale: string;
    currency: string;
    emailVerifiedAt: string | null;
    lastSignedInAt: string | null;
    createdAt: string;
    phone: string | null;
    notes: string | null;
    marketingStatus: string | null;
    marketingConsentAt: string | null;
    marketingConsentSource: string | null;
  }>;
  orders: readonly Readonly<{
    id: string;
    orderNumber: string;
    status: string;
    currency: string;
    totalPresentmentMinor: string;
    totalEurMinor: string;
    itemCount: number;
    invoiceCount: number;
    placedAt: string | null;
    createdAt: string;
  }>[];
  addresses: readonly Readonly<{
    id: string;
    label: string | null;
    recipientName: string;
    city: string;
    region: string | null;
    countryCode: string;
    defaultShipping: boolean;
    defaultBilling: boolean;
  }>[];
  messages: readonly Readonly<{
    id: string;
    templateKey: string;
    kind: string;
    status: string;
    subject: string | null;
    scheduledAt: string;
    sentAt: string | null;
  }>[];
  consentEvents: readonly Readonly<{
    id: string;
    action: string;
    source: string;
    occurredAt: string;
  }>[];
}>;

const PAGE_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function number(value: string | number | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCustomerFilters(
  raw: Record<string, string | string[] | undefined>
): CustomerDirectoryFilters {
  const value = (key: string): string => {
    const candidate = raw[key];
    return (Array.isArray(candidate) ? candidate[0] : candidate)?.trim() ?? "";
  };
  const statusValue = value("status");
  const marketingValue = value("marketing");
  const pageValue = Number.parseInt(value("page"), 10);
  const statuses = ["all", "invited", "active", "suspended", "deleted"] as const;
  const marketingStatuses = ["all", "subscribed", "unsubscribed", "suppressed", "none"] as const;
  return {
    query: value("q").slice(0, 120),
    status: statuses.includes(statusValue as (typeof statuses)[number])
      ? statusValue as CustomerDirectoryFilters["status"]
      : "all",
    marketing: marketingStatuses.includes(marketingValue as (typeof marketingStatuses)[number])
      ? marketingValue as CustomerDirectoryFilters["marketing"]
      : "all",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10_000) : 1
  };
}

export async function loadCustomerDirectory(
  userId: string,
  filters: CustomerDirectoryFilters
): Promise<CustomerDirectory> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [summary] = await sql<{
      total: string;
      active: string;
      buyers: string;
      subscribed: string;
    }[]>`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE account.status = 'active')::text AS active,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM pixbrik.commerce_order orders
          WHERE orders.customer_user_id = account.id AND orders.placed_at IS NOT NULL
        ))::text AS buyers,
        count(*) FILTER (WHERE contact.status = 'subscribed')::text AS subscribed
      FROM pixbrik.app_user account
      LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = account.id
      WHERE account.kind = 'customer'
    `;

    const pattern = `%${filters.query}%`;
    const offset = (filters.page - 1) * PAGE_SIZE;
    const [matchCount] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pixbrik.app_user account
      LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = account.id
      WHERE account.kind = 'customer'
        AND (${filters.query === ""} OR account.email ILIKE ${pattern}
          OR coalesce(account.display_name, '') ILIKE ${pattern})
        AND (${filters.status === "all"} OR account.status::text = ${filters.status})
        AND (
          ${filters.marketing === "all"}
          OR (${filters.marketing === "none"} AND contact.id IS NULL)
          OR contact.status = ${filters.marketing}
        )
    `;

    const rows = await sql<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      preferred_locale: string;
      preferred_currency: string;
      email_verified_at: Date | string | null;
      marketing_status: string | null;
      placed_orders: string;
      placed_value_eur_minor: string;
      last_order_at: Date | string | null;
      created_at: Date | string;
    }[]>`
      SELECT
        account.id::text,
        account.email,
        account.display_name,
        account.status::text,
        account.preferred_locale,
        account.preferred_currency,
        account.email_verified_at,
        contact.status AS marketing_status,
        coalesce(order_stats.placed_orders, 0)::text AS placed_orders,
        coalesce(order_stats.placed_value_eur_minor, 0)::text AS placed_value_eur_minor,
        order_stats.last_order_at,
        account.created_at
      FROM pixbrik.app_user account
      LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = account.id
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE orders.placed_at IS NOT NULL) AS placed_orders,
          coalesce(sum(orders.total_eur_minor) FILTER (WHERE orders.placed_at IS NOT NULL), 0)
            AS placed_value_eur_minor,
          max(orders.placed_at) AS last_order_at
        FROM pixbrik.commerce_order orders
        WHERE orders.customer_user_id = account.id
      ) order_stats ON true
      WHERE account.kind = 'customer'
        AND (${filters.query === ""} OR account.email ILIKE ${pattern}
          OR coalesce(account.display_name, '') ILIKE ${pattern})
        AND (${filters.status === "all"} OR account.status::text = ${filters.status})
        AND (
          ${filters.marketing === "all"}
          OR (${filters.marketing === "none"} AND contact.id IS NULL)
          OR contact.status = ${filters.marketing}
        )
      ORDER BY account.created_at DESC, account.id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

    const totalMatches = number(matchCount?.count);
    return {
      summary: {
        total: number(summary?.total),
        active: number(summary?.active),
        buyers: number(summary?.buyers),
        subscribed: number(summary?.subscribed)
      },
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        status: row.status,
        locale: row.preferred_locale,
        currency: row.preferred_currency,
        emailVerifiedAt: iso(row.email_verified_at),
        marketingStatus: row.marketing_status,
        placedOrders: number(row.placed_orders),
        placedValueEurMinor: row.placed_value_eur_minor,
        lastOrderAt: iso(row.last_order_at),
        createdAt: iso(row.created_at) ?? new Date(0).toISOString()
      })),
      totalMatches,
      page: filters.page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(totalMatches / PAGE_SIZE))
    };
  });
}

export async function loadCustomerDetail(
  userId: string,
  customerId: string
): Promise<CustomerDetail | null> {
  if (!UUID_PATTERN.test(customerId)) return null;
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [customer] = await sql<{
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      preferred_locale: string;
      preferred_currency: string;
      email_verified_at: Date | string | null;
      last_signed_in_at: Date | string | null;
      created_at: Date | string;
      phone_e164: string | null;
      customer_notes: string | null;
      marketing_status: string | null;
      consent_at: Date | string | null;
      consent_source: string | null;
    }[]>`
      SELECT account.id::text, account.email, account.display_name, account.status::text,
        account.preferred_locale, account.preferred_currency, account.email_verified_at,
        account.last_signed_in_at, account.created_at, profile.phone_e164,
        profile.customer_notes, contact.status AS marketing_status,
        contact.consent_at, contact.consent_source
      FROM pixbrik.app_user account
      LEFT JOIN pixbrik.customer_profile profile ON profile.user_id = account.id
      LEFT JOIN pixbrik.marketing_contact contact ON contact.customer_user_id = account.id
      WHERE account.id = ${customerId}::uuid AND account.kind = 'customer'
      LIMIT 1
    `;
    if (!customer) return null;

    const [orders, addresses, messages, consentEvents] = await Promise.all([
      sql<{
        id: string;
        order_number: string;
        status: string;
        presentment_currency: string;
        total_presentment_minor: string;
        total_eur_minor: string;
        item_count: string;
        invoice_count: string;
        placed_at: Date | string | null;
        created_at: Date | string;
      }[]>`
        SELECT orders.id::text, orders.order_number, orders.status::text,
          orders.presentment_currency, orders.total_presentment_minor::text,
          orders.total_eur_minor::text,
          (SELECT count(*) FROM pixbrik.order_item item WHERE item.order_id = orders.id)::text AS item_count,
          (SELECT count(*) FROM pixbrik.invoice_document invoice WHERE invoice.order_id = orders.id)::text AS invoice_count,
          orders.placed_at, orders.created_at
        FROM pixbrik.commerce_order orders
        WHERE orders.customer_user_id = ${customerId}::uuid
        ORDER BY coalesce(orders.placed_at, orders.created_at) DESC, orders.id DESC
        LIMIT 100
      `,
      sql<{
        id: string;
        label: string | null;
        recipient_name: string;
        city: string;
        region: string | null;
        country_code: string;
        is_default_shipping: boolean;
        is_default_billing: boolean;
      }[]>`
        SELECT id::text, label, recipient_name, city, region, country_code,
          is_default_shipping, is_default_billing
        FROM pixbrik.customer_address
        WHERE user_id = ${customerId}::uuid
        ORDER BY is_default_shipping DESC, is_default_billing DESC, created_at DESC
      `,
      sql<{
        id: string;
        template_key: string;
        message_kind: string;
        status: string;
        subject_snapshot: string | null;
        scheduled_at: Date | string;
        sent_at: Date | string | null;
      }[]>`
        SELECT message.id::text, template.template_key, message.message_kind,
          message.status::text, message.subject_snapshot, message.scheduled_at, message.sent_at
        FROM pixbrik.outbound_message message
        JOIN pixbrik.communication_template template ON template.id = message.template_id
        WHERE message.customer_user_id = ${customerId}::uuid
        ORDER BY message.created_at DESC
        LIMIT 50
      `,
      sql<{
        id: string;
        action: string;
        source: string;
        occurred_at: Date | string;
      }[]>`
        SELECT event.id::text, event.action, event.source, event.occurred_at
        FROM pixbrik.marketing_consent_event event
        JOIN pixbrik.marketing_contact contact ON contact.id = event.marketing_contact_id
        WHERE contact.customer_user_id = ${customerId}::uuid
        ORDER BY event.occurred_at DESC
        LIMIT 50
      `
    ]);

    return {
      customer: {
        id: customer.id,
        email: customer.email,
        displayName: customer.display_name,
        status: customer.status,
        locale: customer.preferred_locale,
        currency: customer.preferred_currency,
        emailVerifiedAt: iso(customer.email_verified_at),
        lastSignedInAt: iso(customer.last_signed_in_at),
        createdAt: iso(customer.created_at) ?? new Date(0).toISOString(),
        phone: customer.phone_e164,
        notes: customer.customer_notes,
        marketingStatus: customer.marketing_status,
        marketingConsentAt: iso(customer.consent_at),
        marketingConsentSource: customer.consent_source
      },
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        currency: order.presentment_currency,
        totalPresentmentMinor: order.total_presentment_minor,
        totalEurMinor: order.total_eur_minor,
        itemCount: number(order.item_count),
        invoiceCount: number(order.invoice_count),
        placedAt: iso(order.placed_at),
        createdAt: iso(order.created_at) ?? new Date(0).toISOString()
      })),
      addresses: addresses.map((address) => ({
        id: address.id,
        label: address.label,
        recipientName: address.recipient_name,
        city: address.city,
        region: address.region,
        countryCode: address.country_code,
        defaultShipping: address.is_default_shipping,
        defaultBilling: address.is_default_billing
      })),
      messages: messages.map((message) => ({
        id: message.id,
        templateKey: message.template_key,
        kind: message.message_kind,
        status: message.status,
        subject: message.subject_snapshot,
        scheduledAt: iso(message.scheduled_at) ?? new Date(0).toISOString(),
        sentAt: iso(message.sent_at)
      })),
      consentEvents: consentEvents.map((event) => ({
        id: event.id,
        action: event.action,
        source: event.source,
        occurredAt: iso(event.occurred_at) ?? new Date(0).toISOString()
      }))
    };
  });
}
