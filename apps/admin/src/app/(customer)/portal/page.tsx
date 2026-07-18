import Link from "next/link";

import { requirePrincipal } from "@/lib/auth";
import { APP_ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function CustomerPortalPage() {
  const principal = await requirePrincipal();
  return (
    <main className="public-page">
      <section className="public-card">
        <span className="eyebrow">Secure customer portal</span>
        <h1>Your PixBrik builds.</h1>
        <p>Signed in as {principal.email}.</p>
        <p>
          This protected surface will contain design approvals, retakes, orders, invoices, delivery tracking and localized assembly guides. Order records will come from PostgreSQL rather than browser storage.
        </p>
        <Link className="primary-link" href={APP_ROUTES.dashboard}>Return to operations</Link>
      </section>
    </main>
  );
}
