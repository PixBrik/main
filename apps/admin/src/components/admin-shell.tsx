import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";

import { BricklingAvatar } from "@/components/brickling-avatar";
import type { Principal } from "@/lib/auth";
import { ADMIN_SECTIONS } from "@/lib/launch-config";

type AdminShellProps = {
  principal: Principal;
  children: React.ReactNode;
};

export function AdminShell({ principal, children }: AdminShellProps) {
  return (
    <div className="admin-frame">
      <aside className="sidebar">
        <Link className="brand" href="/admin" aria-label="PixBrik operations home">
          <span>PIXBRIK</span>
          <small>OPERATIONS</small>
        </Link>

        <nav className="nav-stack" aria-label="Administration">
          <Link className="nav-link" href="/admin">
            <span className="nav-dot" />
            Launch control
          </Link>
          {ADMIN_SECTIONS.map((section) => (
            <Link className="nav-link" href={`/admin/${section.key}`} key={section.key}>
              <span className="nav-dot" />
              {section.label}
            </Link>
          ))}
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
            <Link className="quiet-button" href="/portal">
              Customer portal
            </Link>
            {principal.provider === "clerk" ? (
              <SignOutButton redirectUrl="/sign-in">
                <button className="quiet-button" type="button">Sign out</button>
              </SignOutButton>
            ) : null}
            <span className="environment-pill">Foundation</span>
          </div>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
