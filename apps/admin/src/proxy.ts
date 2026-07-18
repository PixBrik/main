import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { authMode } from "./lib/env";

const clerkProxy = clerkMiddleware();

/**
 * Next.js 16 request proxy. Clerk only enriches requests in Clerk mode;
 * authorization remains inside the protected server layouts and handlers.
 */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (authMode() !== "clerk") return NextResponse.next();
  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)"
  ]
};
