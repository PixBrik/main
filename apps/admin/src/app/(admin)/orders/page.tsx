import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import {
  loadOrderDirectory,
  normalizeOrderFilters,
  ORDER_STATUS_OPTIONS,
  type OrderDirectoryFilters
} from "@/lib/orders";
import { customerDetailRoute, orderDetailRoute } from "@/lib/routes";

type OrdersPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

const integer = new Intl.NumberFormat("en-GB");
const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });

function money(minor: string, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency })
    .format(Number(BigInt(minor)) / 100);
}

function date(value: string | null): string {
  if (!value) return "Not placed";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(value));
}

function statusLabel(status: string): string {
  const label = status.replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function statusTone(status: string): "ready" | "blocked" | "pending" {
  if (status === "delivered" || status === "shipped") return "ready";
  if (["cancelled", "partially_refunded", "refunded", "disputed"].includes(status)) {
    return "blocked";
  }
  return "pending";
}

function pageHref(filters: OrderDirectoryFilters, snapshot: string, page: number): string {
  const params = new URLSearchParams({ snapshot });
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "all") params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  return `/orders?${params.toString()}`;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const principal = await requirePermission("orders.read");
  const filters = normalizeOrderFilters(await searchParams);
  const directory = await loadOrderDirectory(principal.userId, filters);
  const hasFilters = Boolean(filters.query || filters.status !== "all");

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Commerce / Orders</span>
          <h1>Orders.</h1>
          <p>Find every checkout by order number or customer email, then open its items, payment trail, invoice records and fulfilment history.</p>
        </div>
        <StatusBadge tone="ready">Live order records</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Order summary">
        <article className="metric-card"><span className="eyebrow">Orders</span><strong>{integer.format(directory.summary.total)}</strong><small>including checkout drafts</small></article>
        <article className="metric-card"><span className="eyebrow">Needs action</span><strong>{integer.format(directory.summary.needsAction)}</strong><small>approval, payment or dispute</small></article>
        <article className="metric-card"><span className="eyebrow">In fulfilment</span><strong>{integer.format(directory.summary.inFulfilment)}</strong><small>paid through ready to ship</small></article>
        <article className="metric-card"><span className="eyebrow">Net settled value</span><strong>{eur.format(Number(BigInt(directory.summary.netSettledValueEurMinor)) / 100)}</strong><small>payments less reversals in EUR</small></article>
      </section>

      <section className="panel" aria-labelledby="order-directory-title">
        <div className="panel-header customer-directory-header">
          <div><span className="eyebrow">Order directory</span><h2 id="order-directory-title">Purchase and fulfilment records</h2></div>
          <span className="mono">{integer.format(directory.totalMatches)} matches</span>
        </div>

        <form className="customer-filters" method="get">
          <label className="staff-field">
            <span>Search</span>
            <input name="q" type="search" defaultValue={filters.query} placeholder="Order number or customer email" maxLength={120} />
          </label>
          <label className="staff-field">
            <span>Order status</span>
            <select name="status" defaultValue={filters.status}>
              <option value="all">All statuses</option>
              {ORDER_STATUS_OPTIONS.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
          <button className="staff-button staff-button-primary" type="submit">Apply filters</button>
          {hasFilters ? <Link className="staff-button staff-button-secondary" href="/orders">Clear</Link> : null}
        </form>

        {directory.items.length === 0 ? (
          <div className="empty-state empty-state-compact">
            <div>
              <strong>{hasFilters ? "No orders match" : "No orders yet"}</strong>
              <span>{hasFilters ? "Clear or change the search and status filter." : "Checkout drafts and placed orders will appear here as soon as they are saved to the commerce database."}</span>
            </div>
          </div>
        ) : (
          <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Order records">
            <table className="records-table customer-table">
              <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col">Placed</th></tr></thead>
              <tbody>{directory.items.map((order) => (
                <tr key={order.id}>
                  <td><Link className="customer-record-link" href={orderDetailRoute(order.id)}><strong>{order.orderNumber}</strong><span>Created {date(order.createdAt)}</span></Link></td>
                  <td>{order.customerUserId ? <Link className="customer-record-link" href={customerDetailRoute(order.customerUserId)}><strong>{order.customerName || "Customer account"}</strong><span>{order.customerEmail}</span></Link> : <><strong>Guest checkout</strong><small>{order.customerEmail}</small></>}</td>
                  <td><StatusBadge tone={statusTone(order.status)}>{statusLabel(order.status)}</StatusBadge><small>Updated {date(order.updatedAt)}</small></td>
                  <td><strong>{integer.format(order.itemCount)}</strong><small>configured products</small></td>
                  <td><strong>{money(order.totalPresentmentMinor, order.currency)}</strong><small>{money(order.totalEurMinor, "EUR")} frozen EUR value</small></td>
                  <td>{date(order.placedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {directory.totalPages > 1 ? (
          <nav className="customer-pagination" aria-label="Order pages">
            {directory.page > 1 ? <Link className="staff-button staff-button-secondary" href={pageHref(filters, directory.snapshot, directory.page - 1)}>Previous</Link> : <span />}
            <span>Page {directory.page} of {directory.totalPages}</span>
            {directory.page < directory.totalPages ? <Link className="staff-button staff-button-secondary" href={pageHref(filters, directory.snapshot, directory.page + 1)}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
