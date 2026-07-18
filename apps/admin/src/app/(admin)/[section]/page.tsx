import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import { getSectionSnapshot, isGenericSectionKey } from "@/lib/admin/section-data";
import { SECTION_PERMISSION } from "@/lib/permissions";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { section: sectionKey } = await params;
  if (!isGenericSectionKey(sectionKey) || !(sectionKey in SECTION_PERMISSION)) notFound();

  const principal = await requirePermission(SECTION_PERMISSION[sectionKey]);
  const snapshot = await getSectionSnapshot(sectionKey, principal.userId);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{snapshot.eyebrow}</span>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.description}</p>
        </div>
        <StatusBadge tone="ready">Production data</StatusBadge>
      </div>

      <section className="grid-4" aria-label={`${snapshot.title} summary`}>
        {snapshot.metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className="eyebrow">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="panel" aria-labelledby="records-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Database records</span>
            <h2 id="records-title">{snapshot.title}</h2>
          </div>
          <div className="record-actions">
            <span className="mono">{snapshot.rows.length} shown</span>
            {snapshot.action ? (
              <Link className="staff-button staff-button-primary" href={snapshot.action.href}>
                {snapshot.action.label}
              </Link>
            ) : null}
          </div>
        </div>

        {snapshot.rows.length === 0 ? (
          <div className="empty-state empty-state-compact">
            <div>
              <strong>{snapshot.emptyTitle}</strong>
              <span>{snapshot.emptyDescription}</span>
            </div>
          </div>
        ) : (
          <div
            className="records-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${snapshot.title} records`}
          >
            <table className="records-table">
              <thead>
                <tr>
                  {snapshot.columns.map((column) => <th scope="col" key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((row) => (
                  <tr key={row.id}>
                    {row.values.map((value, index) => (
                      <td key={`${row.id}-${snapshot.columns[index]}`}>{value}</td>
                    ))}
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
