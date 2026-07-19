"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_BASE_PATH } from "@/lib/routes";

export type AdminNavigationItem = Readonly<{
  href: string;
  label: string;
}>;

function routeLocalPath(pathname: string): string {
  const local = pathname.startsWith(ADMIN_BASE_PATH)
    ? pathname.slice(ADMIN_BASE_PATH.length)
    : pathname;
  return local || "/";
}

export function AdminNavigation({ items }: Readonly<{ items: readonly AdminNavigationItem[] }>) {
  const pathname = routeLocalPath(usePathname());
  return (
    <nav className="nav-stack" aria-label="Administration">
      {items.map((item) => {
        const active = item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
