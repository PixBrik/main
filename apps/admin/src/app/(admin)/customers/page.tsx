import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import {
  loadCustomerDirectory,
  normalizeCustomerFilters
} from "@/lib/customers";
import { customerDetailRoute } from "@/lib/routes";

type CustomersPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

const integer = new Intl.NumberFormat("en-GB");
const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });

function money(minor: string): string {
  return eur.format(Number(BigInt(minor)) / 100);
}

function date(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

function pageHref(
  filters: ReturnType<typeof normalizeCustomerFilters>,
  page: number
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.marketing !== "all") params.set("marketing", filters.marketing);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/customers?${query}` : "/customers";
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const principal = await requirePermission("customers.read");
  const filters = normalizeCustomerFilters(await searchParams);
  const directory = await loadCustomerDirectory(principal.userId, filters);
  const hasFilters = Boolean(filters.query || filters.status !== "all" || filters.marketing !== "all");

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Customers / CRM</span>
          <h1>Customers.</h1>
          <p>Search customer accounts, open their complete order history and review communication consent without exposing payment credentials.</p>
        </div>
        <StatusBadge tone="ready">Live customer records</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Customer summary">
        <article className="metric-card"><span className="eyebrow">Customers</span><strong>{integer.format(directory.summary.total)}</strong><small>registered accounts</small></article>
        <article className="metric-card"><span className="eyebrow">Active</span><strong>{integer.format(directory.summary.active)}</strong><small>accounts with access</small></article>
        <article className="metric-card"><span className="eyebrow">Past buyers</span><strong>{integer.format(directory.summary.buyers)}</strong><small>linked placed orders</small></article>
        <article className="metric-card"><span className="eyebrow">Newsletter</span><strong>{integer.format(directory.summary.subscribed)}</strong><small>explicitly subscribed</small></article>
      </section>

      <section className="panel" aria-labelledby="customer-directory-title">
        <div className="panel-header customer-directory-header">
          <div><span className="eyebrow">Customer directory</span><h2 id="customer-directory-title">Accounts and order history</h2></div>
          <span className="mono">{integer.format(directory.totalMatches)} matches</span>
        </div>
        <form className="customer-filters" method="get">
          <label className="staff-field">
            <span>Search</span>
            <input name="q" type="search" defaultValue={filters.query} placeholder="Name or email" maxLength={120} />
          </label>
          <label className="staff-field">
            <span>Account status</span>
            <select name="status" defaultValue={filters.status}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </select>
          </label>
          <label className="staff-field">
            <span>Marketing</span>
            <select name="marketing" defaultValue={filters.marketing}>
              <option value="all">All contacts</option>
              <option value="subscribed">Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="suppressed">Suppressed</option>
              <option value="none">No marketing record</option>
            </select>
          </label>
          <button className="staff-button staff-button-primary" type="submit">Apply filters</button>
          {hasFilters ? <Link className="staff-button staff-button-secondary" href="/customers">Clear</Link> : null}
        </form>

        {directory.items.length === 0 ? (
          <div className="empty-state empty-state-compact">
            <div><strong>{hasFilters ? "No customers match" : "No customer accounts yet"}</strong><span>{hasFilters ? "Clear or change the filters to widen the search." : "New server-backed customer accounts will appear here."}</span></div>
          </div>
        ) : (
          <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Customer records">
            <table className="records-table customer-table">
              <thead><tr><th scope="col">Customer</th><th scope="col">Account</th><th scope="col">Orders</th><th scope="col">Order value</th><th scope="col">Marketing</th><th scope="col">Joined</th></tr></thead>
              <tbody>{directory.items.map((customer) => (
                <tr key={customer.id}>
                  <td><Link className="customer-record-link" href={customerDetailRoute(customer.id)}><strong>{customer.displayName || "Unnamed customer"}</strong><span>{customer.email}</span></Link></td>
                  <td><strong>{customer.status}</strong><small>{customer.locale.toUpperCase()} / {customer.currency} / {customer.emailVerifiedAt ? "verified" : "unverified"}</small></td>
                  <td><strong>{integer.format(customer.placedOrders)}</strong><small>Last: {date(customer.lastOrderAt)}</small></td>
                  <td><strong>{money(customer.placedValueEurMinor)}</strong><small>placed EUR value</small></td>
                  <td><StatusBadge tone={customer.marketingStatus === "subscribed" ? "ready" : customer.marketingStatus === "suppressed" ? "blocked" : "pending"}>{customer.marketingStatus ?? "not subscribed"}</StatusBadge></td>
                  <td>{date(customer.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {directory.totalPages > 1 ? (
          <nav className="customer-pagination" aria-label="Customer pages">
            {directory.page > 1 ? <Link className="staff-button staff-button-secondary" href={pageHref(filters, directory.page - 1)}>Previous</Link> : <span />}
            <span>Page {directory.page} of {directory.totalPages}</span>
            {directory.page < directory.totalPages ? <Link className="staff-button staff-button-secondary" href={pageHref(filters, directory.page + 1)}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
