import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/lib/auth";
import { ADMIN_SECTIONS } from "@/lib/launch-config";
import { SECTION_PERMISSION } from "@/lib/permissions";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { section: sectionKey } = await params;
  const section = ADMIN_SECTIONS.find((candidate) => candidate.key === sectionKey);
  if (!section || !(sectionKey in SECTION_PERMISSION)) notFound();

  await requirePermission(SECTION_PERMISSION[sectionKey as keyof typeof SECTION_PERMISSION]);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Operations module</span>
          <h1>{section.label}</h1>
          <p>{section.description}. The route and permission boundary are ready for the first vertical workflow.</p>
        </div>
        <StatusBadge tone="pending">Next increment</StatusBadge>
      </div>
      <section className="empty-state">
        <div>
          <strong>No production records yet</strong>
          <span>Connect PostgreSQL, apply migrations and implement this module against the versioned domain model.</span>
        </div>
      </section>
    </>
  );
}
