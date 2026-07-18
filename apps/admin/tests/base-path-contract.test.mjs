import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_BASE_PATH,
  APP_ROUTES,
  PUBLIC_ROUTES,
  adminSectionRoute,
  withAdminBasePath
} from "../src/lib/routes.ts";

const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
const authProvider = await readFile(new URL("../src/components/auth-provider.tsx", import.meta.url), "utf8");
const signIn = await readFile(new URL("../src/app/sign-in/[[...sign-in]]/page.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/admin-shell.tsx", import.meta.url), "utf8");
const portal = await readFile(new URL("../src/app/(customer)/portal/page.tsx", import.meta.url), "utf8");
const protectedLayout = await readFile(new URL("../src/app/(admin)/layout.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/(admin)/page.tsx", import.meta.url), "utf8");

test("admin public routes have one immutable backoffice prefix", () => {
  assert.equal(ADMIN_BASE_PATH, "/backoffice");
  assert.equal(APP_ROUTES.dashboard, "/");
  assert.equal(PUBLIC_ROUTES.dashboard, "/backoffice");
  assert.equal(PUBLIC_ROUTES.signIn, "/backoffice/sign-in");
  assert.equal(PUBLIC_ROUTES.forbidden, "/backoffice/forbidden");
  assert.equal(PUBLIC_ROUTES.portal, "/backoffice/portal");
  assert.equal(PUBLIC_ROUTES.clerkProxy, "/backoffice/__clerk");
  assert.equal(adminSectionRoute("orders"), "/orders");
  assert.equal(withAdminBasePath(adminSectionRoute("orders")), "/backoffice/orders");
  assert.throws(() => withAdminBasePath("sign-in"), /must start with/);
  assert.match(nextConfig, /basePath:\s*"\/backoffice"/);
  assert.match(envExample, /^APP_URL=http:\/\/localhost:3001\/backoffice$/m);
  assert.match(envExample, /^NEXT_PUBLIC_CLERK_SIGN_IN_URL=\/backoffice\/sign-in$/m);
  assert.match(envExample, /^NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=\/backoffice$/m);
  assert.match(envExample, /^NEXT_PUBLIC_CLERK_PROXY_URL=\/backoffice\/__clerk$/m);
  assert.match(readme, /canonical path/);
});

test("the exact backoffice landing and sections remain server-authorized", () => {
  assert.match(protectedLayout, /requirePermission\("dashboard\.read"\)/);
  assert.match(dashboard, /LaunchControlPage/);
  assert.doesNotMatch(dashboard, /redirect\(/);
});

test("Next routing stays route-local while Clerk receives public paths", () => {
  assert.match(auth, /redirect\(APP_ROUTES\.signIn\)/);
  assert.match(auth, /redirect\(APP_ROUTES\.forbidden\)/);
  assert.match(authProvider, /signInUrl=\{PUBLIC_ROUTES\.signIn\}/);
  assert.match(authProvider, /proxyUrl=\{PUBLIC_ROUTES\.clerkProxy\}/);
  assert.match(signIn, /path=\{PUBLIC_ROUTES\.signIn\}/);
  assert.match(signIn, /fallbackRedirectUrl=\{PUBLIC_ROUTES\.dashboard\}/);
  assert.match(signIn, /redirect\(APP_ROUTES\.dashboard\)/);
  assert.match(shell, /href=\{APP_ROUTES\.dashboard\}/);
  assert.match(portal, /<Link className="primary-link" href=\{APP_ROUTES\.dashboard\}>/);
  assert.doesNotMatch(portal, /<a[^>]+href="\//);
});

test("the request proxy cannot escape the backoffice mount", () => {
  assert.match(proxy, /basePath to proxy matchers at build time/);
  assert.match(proxy, /matcher:\s*\[\s*"\/"/);
  assert.match(proxy, /"\/\(\(\?!_next/);
  assert.match(proxy, /"\/\(api\|trpc\)\(\.\*\)"/);
  assert.match(proxy, /"\/__clerk\/\(\.\*\)"/);
  assert.match(proxy, /frontendApiProxy:\s*\{[\s\S]*path: PUBLIC_ROUTES\.clerkProxy/);
  assert.match(proxy, /authorizedParties: trustedAppOrigin \? \[trustedAppOrigin\] : undefined/);
  assert.match(proxy, /assertSafeAuthEnvironment\(\);\s*return clerkProxy/);
  assert.doesNotMatch(proxy, /"\/backoffice/);
});
