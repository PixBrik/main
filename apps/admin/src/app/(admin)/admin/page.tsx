import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { inspectEnvironment } from "@/lib/env";
import { ADMIN_SECTIONS, COMPLIANCE_GATES, LAUNCH_CONFIG } from "@/lib/launch-config";

export default function LaunchControlPage() {
  const environment = inspectEnvironment();
  const readyCount = environment.filter((check) => check.configured).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Launch control</span>
          <h1>One place to run PixBrik.</h1>
          <p>
            The commerce foundation is deliberately fail-closed. Connect and verify every launch dependency before accepting live orders.
          </p>
        </div>
        <StatusBadge tone="pending">Foundation phase</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Launch summary">
        <article className="metric-card">
          <span className="eyebrow">Environment</span>
          <strong>{readyCount}/{environment.length}</strong>
          <small>required integrations configured</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Languages</span>
          <strong>{LAUNCH_CONFIG.locales.length}</strong>
          <small>including Arabic right-to-left support</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Currencies</span>
          <strong>{LAUNCH_CONFIG.presentmentCurrencies.length}</strong>
          <small>with EUR as immutable base currency</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Compliance</span>
          <strong>{COMPLIANCE_GATES.length}</strong>
          <small>professional-review gates still blocked</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Infrastructure readiness</span>
            <h2>Secrets and services</h2>
          </div>
          <span className="mono">values never displayed</span>
        </div>
        <ul className="checklist">
          {environment.map((check) => (
            <li className="check-row" key={check.key}>
              <strong>{check.label}</strong>
              <span className="mono">{check.key}</span>
              <StatusBadge tone={check.configured ? "ready" : "pending"}>
                {check.configured ? "configured" : "required"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Market definition</span>
            <h2>Commercial defaults</h2>
          </div>
        </div>
        <ul className="config-list">
          <li className="config-row">
            <strong>Locales</strong>
            <span>{LAUNCH_CONFIG.locales.map((locale) => locale.label).join(" · ")}</span>
            <StatusBadge tone="ready">seeded</StatusBadge>
          </li>
          <li className="config-row">
            <strong>Presentment currencies</strong>
            <span>{LAUNCH_CONFIG.presentmentCurrencies.join(" · ")} · base {LAUNCH_CONFIG.baseCurrency}</span>
            <StatusBadge tone="ready">seeded</StatusBadge>
          </li>
          <li className="config-row">
            <strong>Markets</strong>
            <span>{LAUNCH_CONFIG.markets.join(" · ")}</span>
            <StatusBadge tone="pending">rates needed</StatusBadge>
          </li>
          <li className="config-row">
            <strong>Owner invitation</strong>
            <span>{LAUNCH_CONFIG.ownerEmail}</span>
            <StatusBadge tone="pending">link identity</StatusBadge>
          </li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Professional review</span>
            <h2>Compliance cannot be solved by stronger wording</h2>
          </div>
        </div>
        <ul className="checklist">
          {COMPLIANCE_GATES.map((gate) => (
            <li className="check-row" key={gate.name}>
              <strong>{gate.name}</strong>
              <span>{gate.detail}</span>
              <StatusBadge tone="blocked">blocked</StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Workspace modules</span>
            <h2>Operational surfaces</h2>
          </div>
        </div>
        <div className="module-grid">
          {ADMIN_SECTIONS.map((section) => (
            <Link className="module-card" href={`/admin/${section.key}`} key={section.key}>
              <h2>{section.label}</h2>
              <p>{section.description}</p>
              <span className="arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
