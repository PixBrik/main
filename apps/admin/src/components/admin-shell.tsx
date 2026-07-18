import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";

import { signOutPasswordAction } from "@/app/auth-actions";
import { BricklingAvatar } from "@/components/brickling-avatar";
import { hasPermission, type Principal } from "@/lib/auth";
import { ADMIN_SECTIONS } from "@/lib/launch-config";
import { adminSectionRoute, APP_ROUTES, PUBLIC_ROUTES } from "@/lib/routes";

type AdminShellProps = {
  principal: Principal;
  children: React.ReactNode;
};

export function AdminShell({ principal, children }: AdminShellProps) {
  return (
    <div className="admin-frame">
      <aside className="sidebar">
        <Link className="brand" href={APP_ROUTES.dashboard} aria-label="PixBrik operations home">
          <span>PIXBRIK</span>
          <small>OPERATIONS</small>
        </Link>

        <nav className="nav-stack" aria-label="Administration">
          <Link className="nav-link" href={APP_ROUTES.dashboard}>
            <span className="nav-dot" />
            Launch control
          </Link>
          {ADMIN_SECTIONS.map((section) => (
            <Link className="nav-link" href={adminSectionRoute(section.key)} key={section.key}>
              <span className="nav-dot" />
              {section.label}
            </Link>
          ))}
          {principal.provider === "password" && hasPermission(principal, "staff.manage") ? (
            <Link className="nav-link" href={APP_ROUTES.users}>
              <span className="nav-dot" />
              Manage users
            </Link>
          ) : null}
        </nav>

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
            <Link className="quiet-button" href={APP_ROUTES.portal}>
              Customer portal
            </Link>
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
