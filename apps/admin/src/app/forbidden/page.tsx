import { SignOutButton } from "@clerk/nextjs";

import { authMode } from "@/lib/env";

export default function ForbiddenPage() {
  const clerk = authMode() === "clerk";
  return (
    <main className="public-page">
      <section className="public-card">
        <span className="eyebrow">Access denied</span>
        <h1>Permission required.</h1>
        <p>Your identity is valid, but your PixBrik role does not allow this action. Ask an owner to review your assigned role.</p>
        {clerk ? (
          <SignOutButton redirectUrl="/sign-in">
            <button className="primary-link" type="button">Sign out</button>
          </SignOutButton>
        ) : null}
      </section>
    </main>
  );
}
