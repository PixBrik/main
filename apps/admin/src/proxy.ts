import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { appOrigin, assertSafeAuthEnvironment, authMode } from "./lib/env";
import { PUBLIC_ROUTES } from "./lib/routes";

const trustedAppOrigin = appOrigin();
const clerkProxy = clerkMiddleware({
  authorizedParties: trustedAppOrigin ? [trustedAppOrigin] : undefined,
  frontendApiProxy: {
    enabled: true,
    path: PUBLIC_ROUTES.clerkProxy
  }
});

/**
 * Next.js 16 request proxy. Clerk only enriches requests in Clerk mode;
 * authorization remains inside the protected server layouts and handlers.
 */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (authMode() !== "clerk") return NextResponse.next();
  assertSafeAuthEnvironment();
  return clerkProxy(request, event);
}

export const config = {
  // Next.js applies next.config.ts basePath to proxy matchers at build time.
  // Keep these route-local or the generated matcher becomes /backoffice/backoffice.
  matcher: [
    "/",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)"
  ]
};
