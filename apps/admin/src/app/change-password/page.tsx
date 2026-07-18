import { redirect } from "next/navigation";

import { signOutPasswordAction } from "@/app/auth-actions";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { requirePasswordChangePrincipal } from "@/lib/auth";
import { APP_ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const principal = await requirePasswordChangePrincipal();
  if (principal.provider !== "password") redirect(APP_ROUTES.dashboard);

  return (
    <main className="public-page">
      <section className="public-card password-card" aria-labelledby="change-password-title">
        <span className="eyebrow">
          {principal.mustChangePassword ? "First sign-in" : "Account security"}
        </span>
        <h1 id="change-password-title">
          {principal.mustChangePassword ? "Choose your password." : "Change your password."}
        </h1>
        <p>
          {principal.mustChangePassword
            ? "Your temporary password can only be used to reach this page. Replace it before opening the backoffice."
            : "Enter your current password, then choose a new private passphrase."}
        </p>
        <ChangePasswordForm />
        <form action={signOutPasswordAction}>
          <button className="text-button" type="submit">Sign out</button>
        </form>
      </section>
    </main>
  );
}
