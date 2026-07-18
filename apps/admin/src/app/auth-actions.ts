"use server";

import { redirect } from "next/navigation";

import { authMode } from "@/lib/env";
import { logoutPasswordSession } from "@/lib/auth/password-session";
import { requireTrustedMutation } from "@/lib/auth/request-security";
import { APP_ROUTES } from "@/lib/routes";

export async function signOutPasswordAction(): Promise<never> {
  if (authMode() === "password") {
    const context = await requireTrustedMutation();
    await logoutPasswordSession(context.requestId);
  }
  redirect(APP_ROUTES.signIn);
}
