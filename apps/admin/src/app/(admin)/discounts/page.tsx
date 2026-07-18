import { CreateDiscountForm } from "@/components/discounts/create-discount-form";
import { DiscountToggleForm } from "@/components/discounts/discount-toggle-form";
import { StatusBadge } from "@/components/status-badge";
import { hasPermission, requirePermission } from "@/lib/auth";
import {
  loadDiscountDashboard,
  type DiscountCoupon,
  type DiscountStatus
} from "@/lib/discounts";

export const dynamic = "force-dynamic";

const eur = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2
});

const integer = new Intl.NumberFormat("en-GB");

function formatMinor(value: string | null): string {
  if (value === null) return "—";
  return eur.format(Number(BigInt(value)) / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "No limit";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function offerLabel(coupon: DiscountCoupon): string {
  if (coupon.kind === "percentage") {
    return `${((coupon.percentageBasisPoints ?? 0) / 100).toLocaleString("en-GB", {
      maximumFractionDigits: 2
    })}% off`;
  }
  if (coupon.kind === "free_shipping") return "Free shipping";
  return `${formatMinor(coupon.fixedAmountEurMinor)} off`;
}

function statusTone(status: DiscountStatus): "ready" | "blocked" | "pending" {
  if (status === "active") return "ready";
  if (status === "scheduled") return "pending";
  return "blocked";
}

function statusLabel(status: DiscountStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function DiscountsPage() {
  const principal = await requirePermission("discounts.read");
  const canManage = hasPermission(principal, "discounts.manage");
  const { coupons, summary } = await loadDiscountDashboard(principal.userId);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Commerce / Promotions</span>
          <h1>Discounts.</h1>
          <p>
            Create customer-facing coupon codes, control their schedule and redemption limits,
            and disable a code instantly without deleting its usage history.
          </p>
        </div>
        <StatusBadge tone="ready">Database live</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Discount summary">
        <article className="metric-card">
          <span className="eyebrow">Codes</span>
          <strong>{integer.format(summary.total)}</strong>
          <small>configured discounts</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Active now</span>
          <strong>{integer.format(summary.active)}</strong>
          <small>{summary.scheduled} scheduled for later</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Uses</span>
          <strong>{integer.format(summary.usageCount)}</strong>
          <small>reserved or applied redemptions</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Customer savings</span>
          <strong>{formatMinor(summary.discountEurMinor)}</strong>
          <small>applied discount value in EUR</small>
        </article>
      </section>

      <section className="discount-policy-note" aria-labelledby="discount-policy-title">
        <div>
          <span className="eyebrow">Checkout safety</span>
          <strong id="discount-policy-title">Eligibility enforcement remains protected.</strong>
          <p>
            Code management is live. Checkout redemption stays gated until the eligibility engine
            validates basket minimums, markets, expiry and usage limits atomically.
          </p>
        </div>
        <StatusBadge tone="pending">Redemption gated</StatusBadge>
      </section>

      {canManage ? (
        <section className="panel" aria-labelledby="create-discount-title">
          <div className="panel-header">
            <div>
              <span className="eyebrow">New promotion</span>
              <h2 id="create-discount-title">Create a discount code</h2>
            </div>
            <span className="mono">EUR is the pricing base</span>
          </div>
          <CreateDiscountForm />
        </section>
      ) : (
        <aside className="discount-read-only-note" aria-label="Discount access level">
          You have read-only discount access. An owner or marketing manager can create and disable codes.
        </aside>
      )}

      <section className="panel" aria-labelledby="discount-list-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Promotion library</span>
            <h2 id="discount-list-title">Discount codes</h2>
          </div>
          <span className="mono">
            {coupons.length === summary.total
              ? `${summary.total} total`
              : `Latest ${coupons.length} of ${summary.total}`}
          </span>
        </div>

        {coupons.length === 0 ? (
          <div className="empty-state discount-empty-state">
            <div>
              <strong>No discount codes yet</strong>
              <span>
                {canManage
                  ? "Use the form above to create the first customer code."
                  : "A discount manager can create the first customer code."}
              </span>
            </div>
          </div>
        ) : (
          <div className="discount-table-scroller" tabIndex={0} role="region" aria-label="Discount codes table">
            <table className="discount-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Offer</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Limits and use</th>
                  <th scope="col">Savings</th>
                  <th scope="col">Status</th>
                  {canManage ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon.id}>
                    <td>
                      <code className="discount-code">{coupon.code}</code>
                      <strong>{coupon.name}</strong>
                      {coupon.firstOrderOnly ? <small>First order only</small> : null}
                    </td>
                    <td>
                      <strong>{offerLabel(coupon)}</strong>
                      <small>
                        {coupon.minimumSubtotalEurMinor === null
                          ? "No basket minimum"
                          : `${formatMinor(coupon.minimumSubtotalEurMinor)} minimum`}
                      </small>
                    </td>
                    <td>
                      <span>From {formatDate(coupon.startsAt)}</span>
                      <small>Until {formatDate(coupon.endsAt)}</small>
                    </td>
                    <td>
                      <strong>
                        {integer.format(coupon.usageCount)} / {coupon.maxRedemptions ?? "∞"}
                      </strong>
                      <small>
                        {coupon.maxRedemptionsPerCustomer
                          ? `${coupon.maxRedemptionsPerCustomer} per customer`
                          : "No per-customer limit"}
                      </small>
                    </td>
                    <td>
                      <strong>{formatMinor(coupon.discountEurMinor)}</strong>
                      <small>{coupon.appliedCount} applied</small>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(coupon.status)}>
                        {statusLabel(coupon.status)}
                      </StatusBadge>
                    </td>
                    {canManage ? (
                      <td>
                        <DiscountToggleForm
                          couponId={coupon.id}
                          code={coupon.code}
                          updatedAt={coupon.updatedAt}
                          active={coupon.active && !coupon.disabledAt}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
