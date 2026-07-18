import { SignIn, SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getOptionalPrincipal } from "@/lib/auth";
import { authMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const mode = authMode();

  if (mode === "clerk") {
    const session = await auth({ treatPendingAsSignedOut: true });
    if (session.isAuthenticated) {
      const principal = await getOptionalPrincipal();
      if (principal) redirect("/admin");

      return (
        <main className="public-page">
          <section className="public-card">
            <span className="eyebrow">Access denied</span>
            <h1>This account is not invited.</h1>
            <p>
              PixBrik staff access requires a verified primary email, completed multi-factor setup,
              and an active PostgreSQL role assignment. Email alone never grants access.
            </p>
            <SignOutButton redirectUrl="/sign-in">
              <button className="primary-link" type="button">Sign out and use another account</button>
            </SignOutButton>
          </section>
        </main>
      );
    }

    return (
      <main className="public-page">
        <section className="sign-in-card" aria-labelledby="staff-sign-in-title">
          <div className="sign-in-copy">
            <span className="eyebrow">Protected workspace</span>
            <h1 id="staff-sign-in-title">Staff sign in.</h1>
            <p>
              Use your invited PixBrik staff account. Multi-factor setup must be complete before
              this console considers a session authenticated.
            </p>
          </div>
          <SignIn
            routing="path"
            path="/sign-in"
            fallbackRedirectUrl="/admin"
            withSignUp={false}
          />
        </section>
      </main>
    );
  }

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
              Authentication is fail-closed. Configure the dedicated staff identity provider and
              database role before access can be granted.
            </p>
            <p className="mono">Current mode: {mode}</p>
          </>
        )}
      </section>
    </main>
  );
}
