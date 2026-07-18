import { AffiliateCreateForms } from "@/components/affiliates/affiliate-management";
import { AffiliateTables } from "@/components/affiliates/affiliate-tables";
import styles from "@/components/affiliates/affiliate-management.module.css";
import { StatusBadge } from "@/components/status-badge";
import { hasPermission, requirePermission } from "@/lib/auth";
import { listAffiliateOverview } from "@/lib/affiliates";

export const dynamic = "force-dynamic";

function formatEurMinor(value: string): string {
  const minor = BigInt(value);
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, "0");
  return `€${new Intl.NumberFormat("en-GB").format(whole)}.${fraction}`;
}

export default async function AffiliatesPage() {
  const principal = await requirePermission("affiliates.read");
  const overview = await listAffiliateOverview(principal.userId);
  const canManage = hasPermission(principal, "affiliates.manage");
  const activePartners = overview.partners.filter((partner) => partner.status === "active").length;
  const liveCodes = overview.codes.filter((code) => code.usable).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Marketing / Partner operations</span>
          <h1>Affiliates.</h1>
          <p>
            Approve partner relationships, issue trackable codes and pause access instantly while preserving attribution and financial history.
          </p>
        </div>
        <StatusBadge tone={canManage ? "ready" : "pending"}>
          {canManage ? "Management enabled" : "Read only"}
        </StatusBadge>
      </div>

      <section className="grid-4" aria-label="Affiliate programme summary">
        <article className="metric-card">
          <span className="eyebrow">Active partners</span>
          <strong>{activePartners}</strong>
          <small>{overview.partners.length} relationships recorded</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Live codes</span>
          <strong>{liveCodes}</strong>
          <small>{overview.codes.length} codes retained in total</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Conversions</span>
          <strong>{overview.totalConversions}</strong>
          <small>from {overview.totalAttributions} attributed visits</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Commission value</span>
          <strong>{formatEurMinor(overview.totalCommissionEurMinor)}</strong>
          <small>non-reversed EUR commission records</small>
        </article>
      </section>

      {canManage ? (
        <AffiliateCreateForms
          currencies={overview.currencies}
          partners={overview.partners.map((partner) => ({
            id: partner.id,
            publicName: partner.publicName,
            status: partner.status
          }))}
        />
      ) : (
        <aside className={styles.readOnlyNotice} aria-label="Affiliate access level">
          You have read-only affiliate access. An administrator with affiliate management access can change partners and codes.
        </aside>
      )}

      <AffiliateTables overview={overview} canManage={canManage} />
    </>
  );
}
