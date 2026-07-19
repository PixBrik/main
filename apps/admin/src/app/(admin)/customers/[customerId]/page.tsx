import Link from "next/link";
import { notFound } from "next/navigation";

import { BricklingAvatar } from "@/components/brickling-avatar";
import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import { loadCustomerDetail } from "@/lib/customers";
import { orderDetailRoute } from "@/lib/routes";

type CustomerPageProps = Readonly<{ params: Promise<{ customerId: string }> }>;

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function money(minor: string, currency: string): string {
  const fractionDigits = currency === "JPY" ? 0 : 2;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(BigInt(minor)) / (10 ** fractionDigits));
}

export default async function CustomerPage({ params }: CustomerPageProps) {
  const principal = await requirePermission("customers.read");
  const { customerId } = await params;
  const detail = await loadCustomerDetail(principal.userId, customerId);
  if (!detail) notFound();
  const { customer } = detail;
  const placedOrders = detail.orders.filter((order) => order.placedAt);
  const value = placedOrders.reduce((total, order) => total + BigInt(order.totalEurMinor), 0n);

  return (
    <>
      <Link className="staff-text-link" href="/customers">&larr; Customer directory</Link>
      <div className="page-heading customer-detail-heading">
        <div className="customer-title">
          <BricklingAvatar seed={`customer:${customer.id}`} label={customer.displayName ?? customer.email} />
          <div><span className="eyebrow">Customer / {customer.id}</span><h1>{customer.displayName || "Unnamed customer"}.</h1><p>{customer.email} &middot; {customer.locale.toUpperCase()} &middot; {customer.currency}</p></div>
        </div>
        <StatusBadge tone={customer.status === "active" ? "ready" : "pending"}>{customer.status}</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Customer history summary">
        <article className="metric-card"><span className="eyebrow">Placed orders</span><strong>{placedOrders.length}</strong><small>linked by customer identity</small></article>
        <article className="metric-card"><span className="eyebrow">Placed value</span><strong>{money(value.toString(), "EUR")}</strong><small>frozen EUR order totals</small></article>
        <article className="metric-card"><span className="eyebrow">Marketing</span><strong className="customer-metric-text">{customer.marketingStatus ?? "not subscribed"}</strong><small>{customer.marketingConsentAt ? `since ${date(customer.marketingConsentAt)}` : "no consent evidence"}</small></article>
        <article className="metric-card"><span className="eyebrow">Last sign-in</span><strong className="customer-metric-text">{date(customer.lastSignedInAt)}</strong><small>Joined {date(customer.createdAt)}</small></article>
      </section>

      <section className="grid-2 customer-detail-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Profile</span><h2>Account details</h2></div></div><dl className="customer-facts"><div><dt>Email</dt><dd>{customer.email}</dd></div><div><dt>Verified</dt><dd>{date(customer.emailVerifiedAt)}</dd></div><div><dt>Phone</dt><dd>{customer.phone ?? "Not provided"}</dd></div><div><dt>Marketing source</dt><dd>{customer.marketingConsentSource ?? "Not recorded"}</dd></div><div><dt>Internal notes</dt><dd>{customer.notes ?? "No notes"}</dd></div></dl></article>
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Addresses</span><h2>Saved destinations</h2></div></div>{detail.addresses.length === 0 ? <p>No saved addresses.</p> : <ul className="customer-address-list">{detail.addresses.map((address) => <li key={address.id}><strong>{address.label || address.recipientName}</strong><span>{address.city}{address.region ? `, ${address.region}` : ""} &middot; {address.countryCode}</span><small>{[address.defaultShipping ? "Default shipping" : "", address.defaultBilling ? "Default billing" : ""].filter(Boolean).join(" / ")}</small></li>)}</ul>}</article>
      </section>

      <section className="panel" aria-labelledby="customer-orders-title"><div className="panel-header"><div><span className="eyebrow">Purchase history</span><h2 id="customer-orders-title">Orders</h2></div><span className="mono">{detail.orders.length} records</span></div>{detail.orders.length === 0 ? <div className="empty-state empty-state-compact"><div><strong>No orders yet</strong><span>Orders are associated only through the customer identity, never by guessing from an email address.</span></div></div> : <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Customer orders"><table className="records-table"><thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Items</th><th scope="col">Total</th><th scope="col">Invoices</th><th scope="col">Placed</th></tr></thead><tbody>{detail.orders.map((order) => <tr key={order.id}><td><Link className="customer-record-link" href={orderDetailRoute(order.id)}><strong>{order.orderNumber}</strong><span>Open full order</span></Link></td><td>{order.status.replaceAll("_", " ")}</td><td>{order.itemCount}</td><td>{money(order.totalPresentmentMinor, order.currency)}</td><td>{order.invoiceCount}</td><td>{date(order.placedAt ?? order.createdAt)}</td></tr>)}</tbody></table></div>}</section>

      <section className="grid-2 customer-detail-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Communications</span><h2>Email history</h2></div></div>{detail.messages.length === 0 ? <p>No messages have been queued for this customer.</p> : <ul className="customer-timeline">{detail.messages.map((message) => <li key={message.id}><div><strong>{message.subject || message.templateKey}</strong><span>{message.kind} / {message.status}</span></div><time>{date(message.sentAt ?? message.scheduledAt)}</time></li>)}</ul>}</article>
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Consent evidence</span><h2>Marketing timeline</h2></div></div>{detail.consentEvents.length === 0 ? <p>No marketing consent events. Account creation and purchasing never imply subscription.</p> : <ul className="customer-timeline">{detail.consentEvents.map((event) => <li key={event.id}><div><strong>{event.action}</strong><span>{event.source}</span></div><time>{date(event.occurredAt)}</time></li>)}</ul>}</article>
      </section>
    </>
  );
}
