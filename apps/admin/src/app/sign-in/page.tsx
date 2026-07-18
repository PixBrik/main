import Link from "next/link";

import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const mode = readEnv("AUTH_MODE") ?? "disabled";
  const local = mode === "development" && process.env.NODE_ENV !== "production";
  return (
    <main className="public-page">
      <section className="public-card">
        <span className="eyebrow">Protected workspace</span>
        <h1>Identity required.</h1>
        {local ? (
          <>
            <p>Local development identity is enabled. This mode is rejected in production.</p>
            <Link className="primary-link" href="/admin">Continue locally</Link>
          </>
        ) : (
          <>
            <p>
              Authentication is fail-closed. Select and configure the production identity adapter, link the owner identity, and require MFA before granting access.
            </p>
            <p className="mono">Current mode: {mode}</p>
          </>
        )}
      </section>
    </main>
  );
}
