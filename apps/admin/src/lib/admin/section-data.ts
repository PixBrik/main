import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";

export const GENERIC_SECTION_KEYS = [
  "orders",
  "customers",
  "builds",
  "markets",
  "analytics",
  "settings"
] as const;

export type GenericSectionKey = (typeof GENERIC_SECTION_KEYS)[number];

export type SectionSnapshot = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  metrics: readonly Readonly<{ label: string; value: string; detail: string }>[];
  columns: readonly string[];
  rows: readonly Readonly<{ id: string; values: readonly string[] }>[];
  emptyTitle: string;
  emptyDescription: string;
  action?: Readonly<{ href: string; label: string }>;
}>;

function count(value: string | number | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: string | number | bigint | null | undefined): string {
  try {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(
      BigInt(String(value ?? 0))
    );
  } catch {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(count(value));
  }
}

function money(value: string | number | bigint | null | undefined): string {
  let minor: bigint;
  try {
    minor = BigInt(String(value ?? 0));
  } catch {
    minor = 0n;
  }
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  const euros = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}€${new Intl.NumberFormat("en-GB").format(euros)}.${cents}`;
}

function date(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

function text(value: unknown, maximumLength = 80): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return rendered.length > maximumLength ? `${rendered.slice(0, maximumLength - 1)}…` : rendered;
}

export function isGenericSectionKey(value: string): value is GenericSectionKey {
  return (GENERIC_SECTION_KEYS as readonly string[]).includes(value);
}

export async function getSectionSnapshot(
  section: GenericSectionKey,
  userId: string
): Promise<SectionSnapshot> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    if (section === "orders") {
      const [summary] = await sql<{
        total: string;
        open: string;
        shipped: string;
        revenue_minor: string;
      }[]>`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE status IN (
            'paid', 'materials_reserved', 'in_production', 'quality_check', 'ready_to_ship'
          ))::text AS open,
          count(*) FILTER (WHERE status IN ('shipped', 'delivered'))::text AS shipped,
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
                  ))
                )
                  THEN payment.amount_eur_minor
                WHEN payment.status = 'succeeded' AND payment.kind IN ('refund', 'credit', 'chargeback')
                  THEN -payment.amount_eur_minor
                ELSE 0
              END
            ), 0)::text
            FROM pixbrik.payment_transaction payment
          ) AS revenue_minor
        FROM pixbrik.commerce_order
      `;
      const rows = await sql<{
        id: string;
        order_number: string;
        customer_email: string;
        status: string;
        total_eur_minor: string;
        created_at: Date | string;
      }[]>`
        SELECT id::text, order_number, customer_email, status::text,
          total_eur_minor::text, created_at
        FROM pixbrik.commerce_order
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return {
        eyebrow: "Commerce / Live records",
        title: "Orders",
        description: "Review every checkout from payment through production and delivery.",
        metrics: [
          { label: "All orders", value: integer(summary?.total), detail: "including drafts" },
          { label: "In fulfilment", value: integer(summary?.open), detail: "paid through ready to ship" },
          { label: "Shipped", value: integer(summary?.shipped), detail: "shipped or delivered" },
          { label: "Net settled value", value: money(summary?.revenue_minor), detail: "payments less reversals in EUR" }
        ],
        columns: ["Order", "Customer", "Status", "Total", "Created"],
        rows: rows.map((row) => ({
          id: row.id,
          values: [row.order_number, row.customer_email, row.status.replaceAll("_", " "), money(row.total_eur_minor), date(row.created_at)]
        })),
        emptyTitle: "No orders yet",
        emptyDescription: "Checkout drafts and placed orders will appear here with their customer, price, production status and fulfilment history."
      };
    }

    if (section === "customers") {
      const [summary] = await sql<{
        total: string;
        active: string;
        ordered: string;
        new_30_days: string;
      }[]>`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE status = 'active')::text AS active,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1
            FROM pixbrik.commerce_order orders
            WHERE orders.customer_user_id = app_user.id AND orders.placed_at IS NOT NULL
          ))::text AS ordered,
          count(*) FILTER (WHERE created_at >= now() - interval '30 days')::text AS new_30_days
        FROM pixbrik.app_user
        WHERE kind = 'customer'
      `;
      const rows = await sql<{
        id: string;
        email: string;
        display_name: string | null;
        status: string;
        orders: string;
        lifetime_value_minor: string;
        created_at: Date | string;
      }[]>`
        SELECT users.id::text, users.email, users.display_name, users.status::text,
          count(orders.id) FILTER (WHERE orders.placed_at IS NOT NULL)::text AS orders,
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
                  ))
                )
                  THEN payment.amount_eur_minor
                WHEN payment.status = 'succeeded' AND payment.kind IN ('refund', 'credit', 'chargeback')
                  THEN -payment.amount_eur_minor
                ELSE 0
              END
            ), 0)::text
            FROM pixbrik.payment_transaction payment
            JOIN pixbrik.commerce_order paid_order ON paid_order.id = payment.order_id
            WHERE paid_order.customer_user_id = users.id
          ) AS lifetime_value_minor,
          users.created_at
        FROM pixbrik.app_user users
        LEFT JOIN pixbrik.commerce_order orders ON orders.customer_user_id = users.id
        WHERE users.kind = 'customer'
        GROUP BY users.id
        ORDER BY users.created_at DESC
        LIMIT 50
      `;
      return {
        eyebrow: "Customers / Live records",
        title: "Customers",
        description: "Find customer accounts, order activity and lifetime value without exposing private payment data.",
        metrics: [
          { label: "Customers", value: integer(summary?.total), detail: "registered accounts" },
          { label: "Active", value: integer(summary?.active), detail: "accounts with access" },
          { label: "With orders", value: integer(summary?.ordered), detail: "customers with a placed order" },
          { label: "New (30d)", value: integer(summary?.new_30_days), detail: "recent registrations" }
        ],
        columns: ["Customer", "Status", "Orders", "Net value", "Joined"],
        rows: rows.map((row) => ({
          id: row.id,
          values: [row.display_name ? `${row.display_name} · ${row.email}` : row.email, row.status, integer(row.orders), money(row.lifetime_value_minor), date(row.created_at)]
        })),
        emptyTitle: "No customer accounts yet",
        emptyDescription: "Customers will appear after they create an account or begin a server-backed checkout."
      };
    }

    if (section === "builds") {
      const [summary] = await sql<{
        total: string;
        generating: string;
        review: string;
        approved: string;
      }[]>`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE status = 'generating')::text AS generating,
          count(*) FILTER (WHERE status = 'customer_review')::text AS review,
          count(*) FILTER (WHERE status = 'approved')::text AS approved
        FROM pixbrik.build
      `;
      const rows = await sql<{
        id: string;
        title: string | null;
        subject_type: string | null;
        status: string;
        retakes_used: number;
        owner_email: string;
        version_count: string;
        updated_at: Date | string;
      }[]>`
        SELECT builds.id::text, builds.title, builds.subject_type, builds.status::text,
          builds.retakes_used, users.email AS owner_email,
          count(versions.id)::text AS version_count, builds.updated_at
        FROM pixbrik.build builds
        JOIN pixbrik.app_user users ON users.id = builds.owner_user_id
        LEFT JOIN pixbrik.build_version versions ON versions.build_id = builds.id
        GROUP BY builds.id, users.email
        ORDER BY builds.updated_at DESC
        LIMIT 50
      `;
      return {
        eyebrow: "Production / Live queue",
        title: "Build queue",
        description: "Track generation, customer review, retakes and approved brick builds.",
        metrics: [
          { label: "Builds", value: integer(summary?.total), detail: "all customer projects" },
          { label: "Generating", value: integer(summary?.generating), detail: "AI work in progress" },
          { label: "In review", value: integer(summary?.review), detail: "awaiting customer choice" },
          { label: "Approved", value: integer(summary?.approved), detail: "ready for commerce" }
        ],
        columns: ["Build", "Customer", "Status", "Versions / retakes", "Updated"],
        rows: rows.map((row) => ({
          id: row.id,
          values: [row.title || row.subject_type || "Untitled build", row.owner_email, row.status.replaceAll("_", " "), `${integer(row.version_count)} / ${row.retakes_used} of 2`, date(row.updated_at)]
        })),
        emptyTitle: "No server-backed builds yet",
        emptyDescription: "Builds saved only in a customer’s browser are not production records. New account-synced generations will appear here."
      };
    }

    if (section === "markets") {
      const [summary] = await sql<{
        markets: string;
        zones: string;
        active_rates: string;
        currencies: string;
      }[]>`
        SELECT
          (SELECT count(*) FROM pixbrik.market WHERE enabled)::text AS markets,
          (SELECT count(*) FROM pixbrik.shipping_zone WHERE enabled)::text AS zones,
          (SELECT count(*) FROM pixbrik.shipping_rate WHERE enabled AND valid_from <= now()
            AND (valid_until IS NULL OR valid_until > now()))::text AS active_rates,
          (SELECT count(*) FROM pixbrik.currency WHERE enabled)::text AS currencies
      `;
      const rows = await sql<{
        id: string;
        name: string;
        code: string;
        enabled: boolean;
        countries: string;
        rates: string;
        lowest_rate_minor: string | null;
      }[]>`
        SELECT zones.id::text, zones.name, zones.code, zones.enabled,
          coalesce(string_agg(DISTINCT countries.country_code, ', ' ORDER BY countries.country_code), 'No countries') AS countries,
          count(DISTINCT rates.id)::text AS rates,
          min(rates.amount_eur_minor)::text AS lowest_rate_minor
        FROM pixbrik.shipping_zone zones
        LEFT JOIN pixbrik.shipping_zone_country countries ON countries.zone_id = zones.id
        LEFT JOIN pixbrik.shipping_rate rates ON rates.zone_id = zones.id
          AND rates.enabled
          AND rates.valid_from <= now()
          AND (rates.valid_until IS NULL OR rates.valid_until > now())
        GROUP BY zones.id
        ORDER BY zones.priority, zones.name
      `;
      return {
        eyebrow: "International selling / Live configuration",
        title: "Markets & shipping",
        description: "Inspect enabled markets, currencies, country groups and the current shipping-rate coverage stored in PostgreSQL.",
        metrics: [
          { label: "Markets", value: integer(summary?.markets), detail: "enabled destinations" },
          { label: "Shipping zones", value: integer(summary?.zones), detail: "enabled country groups" },
          { label: "Active rates", value: integer(summary?.active_rates), detail: "currently selectable" },
          { label: "Currencies", value: integer(summary?.currencies), detail: "customer presentment" }
        ],
        columns: ["Zone", "Code", "Countries", "Rates", "From"],
        rows: rows.map((row) => ({
          id: row.id,
          values: [row.name, `${row.code}${row.enabled ? "" : " · disabled"}`, row.countries, integer(row.rates), row.lowest_rate_minor === null ? "—" : money(row.lowest_rate_minor)]
        })),
        emptyTitle: "No shipping zones configured",
        emptyDescription: "No country groups or current rates are configured. A Markets editing workflow is required before enabling checkout for a new destination."
      };
    }

    if (section === "analytics") {
      const [summary] = await sql<{
        page_views: string;
        sessions: string;
        orders: string;
        revenue_minor: string;
      }[]>`
        SELECT
          (SELECT count(*)
            FROM pixbrik.analytics_page_view page_view
            JOIN pixbrik.analytics_session analytics_session
              ON analytics_session.id = page_view.session_id
            WHERE page_view.started_at >= now() - interval '30 days'
              AND analytics_session.consent_state IN ('granted', 'not_required'))::text AS page_views,
          (SELECT count(*) FROM pixbrik.analytics_session
            WHERE started_at >= now() - interval '30 days'
              AND consent_state IN ('granted', 'not_required'))::text AS sessions,
          (SELECT count(*) FROM pixbrik.commerce_order WHERE placed_at >= now() - interval '30 days')::text AS orders,
          (SELECT coalesce(sum(
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
                ))
              )
                THEN payment.amount_eur_minor
              WHEN payment.status = 'succeeded' AND payment.kind IN ('refund', 'credit', 'chargeback')
                THEN -payment.amount_eur_minor
              ELSE 0
            END
          ), 0)
          FROM pixbrik.payment_transaction payment
          WHERE payment.created_at >= now() - interval '30 days')::text AS revenue_minor
      `;
      const rows = await sql<{
        path: string;
        views: string;
        sessions: string;
        engaged: string;
        average_duration_ms: string | null;
      }[]>`
        SELECT views.path, count(*)::text AS views,
          count(DISTINCT views.session_id)::text AS sessions,
          count(*) FILTER (WHERE views.engaged)::text AS engaged,
          round(avg(views.duration_ms))::text AS average_duration_ms
        FROM pixbrik.analytics_page_view views
        JOIN pixbrik.analytics_session sessions ON sessions.id = views.session_id
        WHERE views.started_at >= now() - interval '30 days'
          AND sessions.consent_state IN ('granted', 'not_required')
        GROUP BY views.path
        ORDER BY count(*) DESC, views.path
        LIMIT 30
      `;
      return {
        eyebrow: "Analytics / Last 30 days",
        title: "Analytics",
        description: "Follow privacy-aware traffic, engagement, orders and EUR revenue from first visit to purchase.",
        metrics: [
          { label: "Page views", value: integer(summary?.page_views), detail: "consented or non-required" },
          { label: "Sessions", value: integer(summary?.sessions), detail: "privacy-safe sessions" },
          { label: "Orders", value: integer(summary?.orders), detail: "placed in 30 days" },
          { label: "Net settled value", value: money(summary?.revenue_minor), detail: "30-day payments less reversals" }
        ],
        columns: ["Path", "Views", "Sessions", "Engaged", "Avg. duration"],
        rows: rows.map((row) => ({
          id: row.path,
          values: [
            row.path,
            integer(row.views),
            integer(row.sessions),
            integer(row.engaged),
            row.average_duration_ms === null
              ? "Not measured"
              : `${Math.round(count(row.average_duration_ms) / 1000)}s`
          ]
        })),
        emptyTitle: "No analytics events yet",
        emptyDescription: "Privacy-aware page views and conversion events will appear here after the buyer app starts sending server-backed analytics."
      };
    }

    const [summary] = await sql<{
      settings: string;
      legal_documents: string;
      templates: string;
      audit_events: string;
    }[]>`
      SELECT
        (SELECT count(*) FROM pixbrik.app_setting)::text AS settings,
        (SELECT count(*) FROM pixbrik.legal_document)::text AS legal_documents,
        (SELECT count(*) FROM pixbrik.communication_template)::text AS templates,
        (SELECT count(*) FROM pixbrik.audit_event WHERE occurred_at >= now() - interval '30 days')::text AS audit_events
    `;
    const rows = await sql<{
      key: string;
      value: unknown;
      description: string | null;
      updated_at: Date | string;
    }[]>`
      SELECT key, value, description, updated_at
      FROM pixbrik.app_setting
      ORDER BY key
      LIMIT 100
    `;
    return {
      eyebrow: "Configuration / Live records",
      title: "Settings",
      description: "Review versioned application settings and manage protected backend access.",
      metrics: [
        { label: "Settings", value: integer(summary?.settings), detail: "versioned application values" },
        { label: "Legal documents", value: integer(summary?.legal_documents), detail: "all locales and versions" },
        { label: "Email templates", value: integer(summary?.templates), detail: "localized communications" },
        { label: "Audit events (30d)", value: integer(summary?.audit_events), detail: "immutable activity trail" }
      ],
      columns: ["Setting", "Value", "Description", "Updated"],
      rows: rows.map((row) => ({
        id: row.key,
        values: [row.key, text(row.value), row.description || "—", date(row.updated_at)]
      })),
      emptyTitle: "No application settings yet",
      emptyDescription: "Core market records are already versioned separately. Optional operational settings will appear here once created.",
      action: { href: "/settings/users", label: "Manage admin users" }
    };
  });
}
