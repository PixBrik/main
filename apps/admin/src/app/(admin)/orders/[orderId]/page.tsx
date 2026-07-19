import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import { loadOrderDetail } from "@/lib/orders";
import { customerDetailRoute } from "@/lib/routes";

type OrderPageProps = Readonly<{ params: Promise<{ orderId: string }> }>;

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function money(minor: string, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(BigInt(minor)) / 100);
}

function jsonSummary(value: unknown): string {
  const rendered = JSON.stringify(value);
  return rendered && rendered.length > 2 ? rendered : "Default configuration";
}

export default async function OrderPage({ params }: OrderPageProps) {
  const principal = await requirePermission("orders.read");
  const { orderId } = await params;
  const detail = await loadOrderDetail(principal.userId, orderId);
  if (!detail) notFound();
  const { order } = detail;

  return (
    <>
      <Link className="staff-text-link" href="/orders">&larr; Orders</Link>
      <div className="page-heading">
        <div><span className="eyebrow">Order / {order.id}</span><h1>{order.orderNumber}.</h1><p>{order.customerEmail} &middot; {order.marketName ?? "Market not assigned"} &middot; {order.locale.toUpperCase()}</p></div>
        <StatusBadge tone={order.status === "delivered" ? "ready" : order.status.includes("cancel") || order.status.includes("refund") ? "blocked" : "pending"}>{order.status.replaceAll("_", " ")}</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Order summary">
        <article className="metric-card"><span className="eyebrow">Total</span><strong>{money(order.totalPresentmentMinor, order.currency)}</strong><small>{money(order.totalEurMinor, "EUR")} frozen EUR value</small></article>
        <article className="metric-card"><span className="eyebrow">Items</span><strong>{detail.items.reduce((sum, item) => sum + item.quantity, 0)}</strong><small>{detail.items.length} line items</small></article>
        <article className="metric-card"><span className="eyebrow">Payment</span><strong className="customer-metric-text">{order.paidAt ? "Paid" : "Not paid"}</strong><small>{date(order.paidAt)}</small></article>
        <article className="metric-card"><span className="eyebrow">Tax</span><strong className="customer-metric-text">{order.taxStatus}</strong><small>{money(order.taxPresentmentMinor, order.currency)}</small></article>
      </section>

      <section className="grid-2 customer-detail-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Customer</span><h2>Order owner</h2></div>{order.customerUserId ? <Link className="staff-button staff-button-secondary" href={customerDetailRoute(order.customerUserId)}>Open customer</Link> : null}</div><dl className="customer-facts"><div><dt>Email snapshot</dt><dd>{order.customerEmail}</dd></div><div><dt>Customer identity</dt><dd>{order.customerUserId ?? "Guest order"}</dd></div><div><dt>Placed</dt><dd>{date(order.placedAt)}</dd></div><div><dt>Last updated</dt><dd>{date(order.updatedAt)}</dd></div></dl></article>
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Price snapshot</span><h2>Frozen totals</h2></div></div><dl className="customer-facts"><div><dt>Subtotal</dt><dd>{money(order.subtotalPresentmentMinor, order.currency)}</dd></div><div><dt>Discount</dt><dd>-{money(order.discountPresentmentMinor, order.currency)}</dd></div><div><dt>Shipping</dt><dd>{money(order.shippingPresentmentMinor, order.currency)}</dd></div><div><dt>Tax</dt><dd>{money(order.taxPresentmentMinor, order.currency)}</dd></div></dl></article>
      </section>

      <section className="panel" aria-labelledby="order-items-title"><div className="panel-header"><div><span className="eyebrow">Builds</span><h2 id="order-items-title">Ordered items</h2></div></div>{detail.items.length === 0 ? <p>No order items have been recorded.</p> : <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Order items"><table className="records-table"><thead><tr><th scope="col">Build</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Configuration</th></tr></thead><tbody>{detail.items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong></td><td>{item.productType ?? "Not classified"}</td><td>{item.quantity}</td><td>{money(item.unitPricePresentmentMinor, order.currency)}</td><td><code className="mono order-json-summary">{jsonSummary(item.configuration)}</code></td></tr>)}</tbody></table></div>}</section>

      <section className="grid-2 customer-detail-grid">
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Money trail</span><h2>Payments and invoices</h2></div></div>{detail.payments.length === 0 && detail.invoices.length === 0 ? <p>No payments or invoices recorded.</p> : <ul className="customer-timeline">{detail.payments.map((payment) => <li key={payment.id}><div><strong>{payment.kind} / {payment.status}</strong><span>{money(payment.amountMinor, payment.currency)}</span></div><time>{date(payment.createdAt)}</time></li>)}{detail.invoices.map((invoice) => <li key={invoice.id}><div><strong>{invoice.number}</strong><span>{invoice.kind} / {invoice.status}</span></div><time>{date(invoice.issuedAt)}</time></li>)}</ul>}</article>
        <article className="panel"><div className="panel-header"><div><span className="eyebrow">Chronology</span><h2>Order events</h2></div></div>{detail.events.length === 0 ? <p>No order events recorded.</p> : <ul className="customer-timeline">{detail.events.map((event) => <li key={event.id}><div><strong>{event.type}</strong><span>{event.fromStatus || "start"} &rarr; {event.toStatus || "unchanged"}{event.note ? ` / ${event.note}` : ""}</span></div><time>{date(event.occurredAt)}</time></li>)}</ul>}</article>
      </section>
    </>
  );
}
