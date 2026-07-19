import { AutomationToggle } from "@/components/marketing/automation-toggle";
import { CampaignActions } from "@/components/marketing/campaign-actions";
import { CreateCampaignForm } from "@/components/marketing/create-campaign-form";
import { StatusBadge } from "@/components/status-badge";
import { hasPermission, requirePermission } from "@/lib/auth";
import { loadMarketingDashboard } from "@/lib/marketing";

export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("en-GB");

function date(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function delay(minutes: number): string {
  if (minutes === 0) return "Immediately";
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? "" : "s"}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function tone(status: string): "ready" | "pending" | "blocked" {
  if (["completed", "delivered", "subscribed"].includes(status)) return "ready";
  if (["failed", "completed_with_errors", "bounced", "complained", "cancelled", "suppressed"].includes(status)) return "blocked";
  return "pending";
}

export default async function MarketingPage() {
  const principal = await requirePermission("marketing.read");
  const dashboard = await loadMarketingDashboard(principal.userId);
  const canManage = hasPermission(principal, "marketing.manage");
  const canSend = hasPermission(principal, "marketing.send");
  const newsletterTemplates = dashboard.templates.filter((family) => family.purpose === "marketing" && family.key.startsWith("newsletter.") && family.variants.length === 5);
  const runtimeChecks = [
    ["Resend API key", dashboard.runtime.apiKey],
    ["Webhook secret configured", dashboard.runtime.webhookSecret],
    ["Sender mailbox configured", dashboard.runtime.sender],
    ["Reply-to mailbox configured", dashboard.runtime.replyTo],
    ["Customer app URL configured", dashboard.runtime.customerApp],
    ["Public unsubscribe URL configured", dashboard.runtime.publicEmailApp],
    ["Cron authentication configured", dashboard.runtime.cronSecret],
    ["Production delivery approval", dashboard.runtime.operatorApproved]
  ] as const;

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">Growth / Customer communications</span><h1>Marketing.</h1><p>Use localized PixBrik templates, send consent-safe newsletters, configure lifecycle automations and monitor every delivery from one place.</p></div>
        <StatusBadge tone={dashboard.runtime.ready ? "ready" : "blocked"}>{dashboard.runtime.ready ? "Configuration approved" : "Sending locked"}</StatusBadge>
      </div>

      <nav className="marketing-tabs" aria-label="Marketing sections"><a href="#contacts">Contacts</a><a href="#templates">Templates</a><a href="#campaigns">Campaigns</a><a href="#automations">Automations</a><a href="#queue">Delivery queue</a></nav>

      <section className="grid-4" aria-label="Marketing summary">
        <article className="metric-card"><span className="eyebrow">Subscribers</span><strong>{integer.format(dashboard.summary.subscribed)}</strong><small>explicit current consent</small></article>
        <article className="metric-card"><span className="eyebrow">Campaigns</span><strong>{integer.format(dashboard.summary.campaigns)}</strong><small>draft through completed</small></article>
        <article className="metric-card"><span className="eyebrow">Queue</span><strong>{integer.format(dashboard.summary.queued)}</strong><small>queued or leased</small></article>
        <article className="metric-card"><span className="eyebrow">Delivered (30d)</span><strong>{integer.format(dashboard.summary.delivered30Days)}</strong><small>{dashboard.summary.failed} currently failed</small></article>
      </section>

      <section className={`marketing-runtime ${dashboard.runtime.ready ? "marketing-runtime-ready" : ""}`} aria-labelledby="email-readiness-title">
        <div><span className="eyebrow">Production safety</span><h2 id="email-readiness-title">{dashboard.runtime.ready ? "Email delivery configuration is approved." : "Email delivery remains locked."}</h2><p>Drafts and localized copy cards work now; an in-app provider test send is not implemented yet. Scheduling and automation activation remain fail-closed until every value is configured and an operator confirms the sender DNS, signed webhook and controlled end-to-end send.</p></div>
        <ul>{runtimeChecks.map(([label, ready]) => <li key={label}><span aria-hidden="true">{ready ? "OK" : "--"}</span>{label}<span className="staff-sr-only">: {ready ? "configured" : "missing"}</span></li>)}</ul>
      </section>

      <section className="panel" id="contacts" aria-labelledby="marketing-contacts-title">
        <div className="panel-header"><div><span className="eyebrow">Audience / Consent projection</span><h2 id="marketing-contacts-title">Newsletter contacts</h2></div><span className="mono">Latest 100 / addresses masked</span></div>
        {dashboard.contacts.length === 0 ? <div className="empty-state empty-state-compact"><div><strong>No consent-bearing contacts yet</strong><span>Accounts and purchases never imply newsletter consent. Explicit opt-ins will appear here with their evidence source.</span></div></div> : <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Newsletter contacts"><table className="records-table"><thead><tr><th scope="col">Contact</th><th scope="col">Status</th><th scope="col">Locale</th><th scope="col">Identity</th><th scope="col">Evidence</th></tr></thead><tbody>{dashboard.contacts.map((contact) => <tr key={contact.id}><td><strong>{contact.displayName || "Unnamed contact"}</strong><small>{contact.email}</small></td><td><StatusBadge tone={tone(contact.status)}>{contact.status}</StatusBadge></td><td>{contact.locale.toUpperCase()}</td><td>{contact.customerAccount ? "Customer account" : "Guest contact"}</td><td><strong>{contact.consentSource || "No active source"}</strong><small>{date(contact.consentAt)}</small></td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel" id="templates" aria-labelledby="marketing-templates-title">
        <div className="panel-header"><div><span className="eyebrow">Prebuilt / Five languages</span><h2 id="marketing-templates-title">PixBrik email templates</h2></div><span className="mono">{dashboard.templates.length} families</span></div>
        <div className="marketing-template-grid">{dashboard.templates.map((family) => <article className="marketing-template-card" key={`${family.key}:${family.version}`}><div className="marketing-template-preview"><span className="eyebrow">{family.purpose} / v{family.version}</span><h3>{family.preview.heading}</h3><p>{family.preview.body}</p><span className="marketing-template-cta">{family.preview.ctaLabel}</span></div><footer><strong>{family.key}</strong><span>{family.variants.map((variant) => variant.locale.toUpperCase()).join(" / ")}</span><small>{family.preview.subject}</small></footer></article>)}</div>
      </section>

      <section className="panel" id="campaigns" aria-labelledby="marketing-campaigns-title">
        <div className="panel-header"><div><span className="eyebrow">Newsletters</span><h2 id="marketing-campaigns-title">Campaigns</h2></div><span className="mono">UTC scheduling</span></div>
        {canManage && newsletterTemplates.length > 0 ? <CreateCampaignForm templates={newsletterTemplates.map((family) => ({ key: family.key, version: family.version, label: `${family.preview.heading} (v${family.version})` }))} /> : null}
        {dashboard.campaigns.length === 0 ? <div className="empty-state empty-state-compact"><div><strong>No campaigns yet</strong><span>{canManage ? "Create a draft above. It will never send until explicitly scheduled." : "A marketing manager can create the first draft."}</span></div></div> : <div className="records-table-wrap marketing-campaign-table" tabIndex={0} role="region" aria-label="Newsletter campaigns"><table className="records-table"><thead><tr><th scope="col">Campaign</th><th scope="col">Audience</th><th scope="col">Schedule</th><th scope="col">Delivery</th><th scope="col">Status</th>{canSend ? <th scope="col">Controls</th> : null}</tr></thead><tbody>{dashboard.campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.templateKey} / v{campaign.templateVersion}</small></td><td><strong>{campaign.audienceKey.replaceAll("_", " ")}</strong><small>{campaign.audienceEstimate} eligible now{campaign.recipientCap ? ` / capped at ${campaign.recipientCap}` : ""}</small></td><td>{date(campaign.scheduledAt)}</td><td><strong>{campaign.delivered} delivered</strong><small>{campaign.recipients} recipients / {campaign.failed} failed / {campaign.suppressed} suppressed</small></td><td><StatusBadge tone={tone(campaign.status)}>{campaign.status.replaceAll("_", " ")}</StatusBadge></td>{canSend ? <td><CampaignActions campaignId={campaign.id} campaignName={campaign.name} status={campaign.status} updatedAt={campaign.updatedAt} sendingReady={dashboard.runtime.ready} audienceSize={campaign.audienceEstimate} /></td> : null}</tr>)}</tbody></table></div>}
      </section>

      <section className="panel" id="automations" aria-labelledby="marketing-automations-title">
        <div className="panel-header"><div><span className="eyebrow">Lifecycle messages</span><h2 id="marketing-automations-title">Automated email rules</h2></div><span className="mono">Installed disabled</span></div>
        <div className="marketing-automation-grid">{dashboard.automations.map((automation) => <article className="marketing-automation-card" key={automation.id}><div><span className="eyebrow">{automation.event}</span><h3>{automation.name}</h3><p>Uses <code>{automation.templateKey}</code> v{automation.templateVersion} {delay(automation.delayMinutes).toLowerCase()} after the source event. Enabling starts from that moment; historical events are never swept.</p>{automation.capabilityReason ? <p className="marketing-failure">{automation.capabilityReason}</p> : null}<div className="marketing-rule-tags"><span>{automation.requiresConsent ? "Explicit consent required" : "Transactional"}</span><StatusBadge tone={automation.enabled ? "ready" : automation.capabilityReady ? "pending" : "blocked"}>{automation.enabled ? "Enabled" : automation.capabilityReady ? "Disabled" : "Capability locked"}</StatusBadge></div></div>{canSend ? <AutomationToggle ruleId={automation.id} enabled={automation.enabled} updatedAt={automation.updatedAt} sendingReady={dashboard.runtime.ready && automation.capabilityReady} /> : null}</article>)}</div>
      </section>

      <section className="panel" id="queue" aria-labelledby="marketing-queue-title">
        <div className="panel-header"><div><span className="eyebrow">Outbox / Provider history</span><h2 id="marketing-queue-title">Delivery queue</h2></div><span className="mono">Recipients masked</span></div>
        {dashboard.messages.length === 0 ? <div className="empty-state empty-state-compact"><div><strong>Queue clear</strong><span>No customer email is waiting or recorded yet.</span></div></div> : <div className="records-table-wrap" tabIndex={0} role="region" aria-label="Email delivery queue"><table className="records-table"><thead><tr><th scope="col">Recipient</th><th scope="col">Template</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">When</th></tr></thead><tbody>{dashboard.messages.map((message) => <tr key={message.id}><td>{message.recipient}</td><td><strong>{message.templateKey}</strong>{message.failure ? <small className="marketing-failure">{message.failure}</small> : null}</td><td>{message.kind}</td><td><StatusBadge tone={tone(message.status)}>{message.status}</StatusBadge></td><td>{message.attempts}</td><td>{date(message.sentAt ?? message.scheduledAt)}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
