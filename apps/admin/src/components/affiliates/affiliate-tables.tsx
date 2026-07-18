import { StatusBadge } from "@/components/status-badge";
import {
  CodeStatusAction,
  PartnerStatusAction
} from "@/components/affiliates/affiliate-management";
import type {
  AffiliateCode,
  AffiliateOverview,
  AffiliatePartner,
  AffiliatePartnerStatus
} from "@/lib/affiliates";

import styles from "./affiliate-management.module.css";

function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-GB", {
    minimumFractionDigits: basisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}%`;
}

function formatEurMinor(value: string): string {
  const minor = BigInt(value);
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  return `€${new Intl.NumberFormat("en-GB").format(whole)}.${fraction}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function partnerTone(status: AffiliatePartnerStatus): "ready" | "pending" | "blocked" {
  if (status === "active") return "ready";
  if (status === "applicant") return "pending";
  return "blocked";
}

function codeStatus(code: AffiliateCode): Readonly<{
  label: string;
  tone: "ready" | "pending" | "blocked";
}> {
  if (code.usable) return { label: "live", tone: "ready" };
  if (!code.active) return { label: "disabled", tone: "blocked" };
  const now = Date.now();
  if (code.startsAt && new Date(code.startsAt).getTime() > now) {
    return { label: "scheduled", tone: "pending" };
  }
  if (code.endsAt && new Date(code.endsAt).getTime() <= now) {
    return { label: "expired", tone: "blocked" };
  }
  return { label: "partner paused", tone: "pending" };
}

function PartnerTable({
  partners,
  canManage
}: Readonly<{ partners: readonly AffiliatePartner[]; canManage: boolean }>) {
  if (partners.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>No affiliate partners yet</strong>
        <span>Add the first applicant above, verify terms, then activate the relationship.</span>
      </div>
    );
  }

  return (
    <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Affiliate partners table">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Partner</th>
            <th scope="col">Status</th>
            <th scope="col">Terms & payout</th>
            <th scope="col">Performance</th>
            <th scope="col">Commission</th>
            {canManage ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.id}>
              <td>
                <strong>{partner.publicName}</strong>
                <a href={`mailto:${partner.contactEmail}`}>{partner.contactEmail}</a>
                <small>Updated {formatDate(partner.updatedAt)}</small>
              </td>
              <td><StatusBadge tone={partnerTone(partner.status)}>{partner.status}</StatusBadge></td>
              <td>
                <strong>{partner.termsVersion ?? "No terms recorded"}</strong>
                <span>{partner.payoutCurrency} payout · {formatPercent(partner.defaultCommissionBasisPoints)} default</span>
              </td>
              <td>
                <strong>{partner.conversionCount} conversions</strong>
                <span>{partner.attributionCount} visits · {partner.activeCodeCount}/{partner.codeCount} active codes</span>
              </td>
              <td><strong>{formatEurMinor(partner.commissionEurMinor)}</strong><span>non-reversed</span></td>
              {canManage ? (
                <td>
                  <PartnerStatusAction
                    partner={{
                      id: partner.id,
                      publicName: partner.publicName,
                      status: partner.status,
                      versionToken: partner.versionToken
                    }}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeTable({
  codes,
  canManage
}: Readonly<{ codes: readonly AffiliateCode[]; canManage: boolean }>) {
  if (codes.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>No affiliate codes yet</strong>
        <span>Activate a partner, then create a memorable code tied to a local PixBrik destination.</span>
      </div>
    );
  }

  return (
    <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Affiliate codes table">
      <table className={`${styles.table} ${styles.codeTable}`}>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Partner</th>
            <th scope="col">Destination</th>
            <th scope="col">Rate</th>
            <th scope="col">Performance</th>
            <th scope="col">Status</th>
            {canManage ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id}>
              <td><code className={styles.code}>{code.code}</code><small>Updated {formatDate(code.updatedAt)}</small></td>
              <td><strong>{code.partnerName}</strong></td>
              <td><span className={styles.path}>{code.destinationPath}</span></td>
              <td>
                <strong>{formatPercent(code.effectiveCommissionBasisPoints)}</strong>
                <span>{code.commissionBasisPoints === null ? "Inherited" : "Override"}</span>
              </td>
              <td><strong>{code.conversionCount} conversions</strong><span>{code.attributionCount} visits</span></td>
              <td>
                <StatusBadge tone={codeStatus(code).tone}>{codeStatus(code).label}</StatusBadge>
              </td>
              {canManage ? (
                <td>
                  <CodeStatusAction
                    code={{
                      id: code.id,
                      code: code.code,
                      active: code.active,
                      versionToken: code.versionToken
                    }}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AffiliateTables({
  overview,
  canManage
}: Readonly<{ overview: AffiliateOverview; canManage: boolean }>) {
  return (
    <>
      <section className="panel" aria-labelledby="affiliate-partners-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Relationships</span>
            <h2 id="affiliate-partners-title">Partners</h2>
          </div>
          <span className="mono">{overview.partners.length} total</span>
        </div>
        <PartnerTable partners={overview.partners} canManage={canManage} />
      </section>

      <section className="panel" aria-labelledby="affiliate-codes-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Attribution entry points</span>
            <h2 id="affiliate-codes-title">Codes</h2>
          </div>
          <span className="mono">{overview.codes.filter((code) => code.usable).length} live</span>
        </div>
        <CodeTable codes={overview.codes} canManage={canManage} />
      </section>
    </>
  );
}
