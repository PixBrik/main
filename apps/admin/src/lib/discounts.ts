import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";

export type DiscountKind = "percentage" | "fixed_eur" | "free_shipping";
export type DiscountStatus = "active" | "scheduled" | "expired" | "disabled";

export type DiscountCoupon = Readonly<{
  id: string;
  code: string;
  name: string;
  kind: DiscountKind;
  percentageBasisPoints: number | null;
  fixedAmountEurMinor: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  minimumSubtotalEurMinor: string | null;
  firstOrderOnly: boolean;
  disabledAt: string | null;
  updatedAt: string;
  usageCount: number;
  appliedCount: number;
  discountEurMinor: string;
  status: DiscountStatus;
}>;

export type DiscountSummary = Readonly<{
  total: number;
  active: number;
  scheduled: number;
  disabled: number;
  usageCount: number;
  discountEurMinor: string;
}>;

type CouponRow = {
  id: string;
  code: string;
  name: string;
  kind: DiscountKind;
  percentage_basis_points: number | null;
  fixed_amount_eur_minor: string | null;
  active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  max_redemptions_per_customer: number | null;
  minimum_subtotal_eur_minor: string | null;
  first_order_only: boolean;
  disabled_at: Date | null;
  updated_at: Date;
  usage_count: number;
  applied_count: number;
  discount_eur_minor: string;
};

type SummaryRow = {
  total: number;
  active: number;
  scheduled: number;
  disabled: number;
  usage_count: number;
  discount_eur_minor: string;
};

function statusForCoupon(row: CouponRow, now: Date): DiscountStatus {
  if (!row.active || row.disabled_at) return "disabled";
  if (row.starts_at && row.starts_at > now) return "scheduled";
  if (row.ends_at && row.ends_at <= now) return "expired";
  return "active";
}

export async function loadDiscountDashboard(
  userId: string
): Promise<Readonly<{ coupons: readonly DiscountCoupon[]; summary: DiscountSummary }>> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const rows = await sql<CouponRow[]>`
      SELECT
        coupon.id::text,
        coupon.code,
        coupon.name,
        coupon.kind::text,
        coupon.percentage_basis_points,
        coupon.fixed_amount_eur_minor::text,
        coupon.active,
        coupon.starts_at,
        coupon.ends_at,
        coupon.max_redemptions,
        coupon.max_redemptions_per_customer,
        coupon.minimum_subtotal_eur_minor::text,
        coupon.first_order_only,
        coupon.disabled_at,
        coupon.updated_at,
        COALESCE(redemptions.usage_count, 0)::integer AS usage_count,
        COALESCE(redemptions.applied_count, 0)::integer AS applied_count,
        COALESCE(redemptions.discount_eur_minor, 0)::text AS discount_eur_minor
      FROM pixbrik.coupon AS coupon
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE status IN ('reserved', 'applied')) AS usage_count,
          count(*) FILTER (WHERE status = 'applied') AS applied_count,
          COALESCE(sum(discount_eur_minor) FILTER (WHERE status = 'applied'), 0) AS discount_eur_minor
        FROM pixbrik.coupon_redemption
        WHERE coupon_id = coupon.id
      ) AS redemptions ON true
      ORDER BY coupon.created_at DESC, coupon.code ASC
      LIMIT 250
    `;
    const [summaryRow] = await sql<SummaryRow[]>`
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (
          WHERE active
            AND disabled_at IS NULL
            AND (starts_at IS NULL OR starts_at <= now())
            AND (ends_at IS NULL OR ends_at > now())
        )::integer AS active,
        count(*) FILTER (
          WHERE active AND disabled_at IS NULL AND starts_at > now()
        )::integer AS scheduled,
        count(*) FILTER (WHERE NOT active OR disabled_at IS NOT NULL)::integer AS disabled,
        (SELECT count(*)::integer FROM pixbrik.coupon_redemption WHERE status IN ('reserved', 'applied')) AS usage_count,
        (SELECT COALESCE(sum(discount_eur_minor), 0)::text FROM pixbrik.coupon_redemption WHERE status = 'applied') AS discount_eur_minor
      FROM pixbrik.coupon
    `;

    const now = new Date();
    const coupons = rows.map((row): DiscountCoupon => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      percentageBasisPoints: row.percentage_basis_points,
      fixedAmountEurMinor: row.fixed_amount_eur_minor,
      active: row.active,
      startsAt: row.starts_at?.toISOString() ?? null,
      endsAt: row.ends_at?.toISOString() ?? null,
      maxRedemptions: row.max_redemptions,
      maxRedemptionsPerCustomer: row.max_redemptions_per_customer,
      minimumSubtotalEurMinor: row.minimum_subtotal_eur_minor,
      firstOrderOnly: row.first_order_only,
      disabledAt: row.disabled_at?.toISOString() ?? null,
      updatedAt: row.updated_at.toISOString(),
      usageCount: row.usage_count,
      appliedCount: row.applied_count,
      discountEurMinor: row.discount_eur_minor,
      status: statusForCoupon(row, now)
    }));

    return {
      coupons,
      summary: summaryRow
        ? {
            total: summaryRow.total,
            active: summaryRow.active,
            scheduled: summaryRow.scheduled,
            disabled: summaryRow.disabled,
            usageCount: summaryRow.usage_count,
            discountEurMinor: summaryRow.discount_eur_minor
          }
        : {
            total: 0,
            active: 0,
            scheduled: 0,
            disabled: 0,
            usageCount: 0,
            discountEurMinor: "0"
          }
    };
  });
}
