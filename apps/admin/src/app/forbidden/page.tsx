import { SignOutButton } from "@clerk/nextjs";

import { signOutPasswordAction } from "@/app/auth-actions";
import { authMode } from "@/lib/env";
import { PUBLIC_ROUTES } from "@/lib/routes";

export default function ForbiddenPage() {
  const mode = authMode();
  return (
    <main className="public-page">
      <section className="public-card">
        <span className="eyebrow">Access denied</span>
        <h1>Permission required.</h1>
        <p>Your identity is valid, but your PixBrik role does not allow this action. Ask an owner to review your assigned role.</p>
        {mode === "clerk" ? (
          <SignOutButton redirectUrl={PUBLIC_ROUTES.signIn}>
            <button className="primary-link" type="button">Sign out</button>
          </SignOutButton>
        ) : null}
        {mode === "password" ? (
          <form action={signOutPasswordAction}>
            <button className="primary-link" type="submit">Sign out</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
