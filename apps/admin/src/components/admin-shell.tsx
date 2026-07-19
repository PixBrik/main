import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";

import { signOutPasswordAction } from "@/app/auth-actions";
import { BricklingAvatar } from "@/components/brickling-avatar";
import { AdminNavigation, type AdminNavigationItem } from "@/components/admin-navigation";
import { hasPermission, type Principal } from "@/lib/auth";
import { ADMIN_SECTIONS } from "@/lib/launch-config";
import { SECTION_PERMISSION } from "@/lib/permissions";
import { adminSectionRoute, APP_ROUTES, PUBLIC_ROUTES } from "@/lib/routes";

type AdminShellProps = {
  principal: Principal;
  children: React.ReactNode;
};

export function AdminShell({ principal, children }: AdminShellProps) {
  const navigation: AdminNavigationItem[] = [
    { href: APP_ROUTES.dashboard, label: "Launch control" },
    ...ADMIN_SECTIONS.flatMap((section) => hasPermission(principal, SECTION_PERMISSION[section.key])
      ? [{ href: adminSectionRoute(section.key), label: section.label }]
      : []),
    ...(principal.provider === "password" && hasPermission(principal, "staff.manage")
      ? [{ href: APP_ROUTES.users, label: "Manage users" }]
      : [])
  ];
  return (
    <div className="admin-frame">
      <aside className="sidebar">
        <Link className="brand" href={APP_ROUTES.dashboard} aria-label="PixBrik operations home">
          <span>PIXBRIK</span>
          <small>OPERATIONS</small>
        </Link>

        <AdminNavigation items={navigation} />

        <div className="sidebar-footer">
          <BricklingAvatar
            seed={`${principal.provider}:${principal.subject}`}
            label={principal.displayName ?? principal.email}
          />
          <div className="sidebar-identity">
            <span className="eyebrow">Signed in</span>
            <strong>{principal.displayName ?? principal.email}</strong>
            <span>{principal.roles.join(", ")}</span>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Production workspace</span>
            <strong>Commerce, builds and fulfilment</strong>
          </div>
          <div className="topbar-actions">
            <a className="quiet-button" href="https://www.pixbrik.com">
              Storefront
            </a>
            {principal.provider === "password" ? (
              <Link className="quiet-button" href={APP_ROUTES.changePassword}>
                Password
              </Link>
            ) : null}
            {principal.provider === "clerk" ? (
              <SignOutButton redirectUrl={PUBLIC_ROUTES.signIn}>
                <button className="quiet-button" type="button">Sign out</button>
              </SignOutButton>
            ) : null}
            {principal.provider === "password" ? (
              <form action={signOutPasswordAction}>
                <button className="quiet-button" type="submit">Sign out</button>
              </form>
            ) : null}
            <span className="environment-pill">Foundation</span>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
