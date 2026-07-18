"use server";

import { redirect } from "next/navigation";

import { LocalAuthError, signInWithPassword } from "@/lib/auth/password-session";
import { requireTrustedMutation } from "@/lib/auth/request-security";
import { APP_ROUTES } from "@/lib/routes";

export type PasswordSignInState = Readonly<{
  error?: string;
}>;

const GENERIC_SIGN_IN_ERROR = "Email or password is incorrect. Please try again.";
const SERVICE_UNAVAILABLE_ERROR = "Sign-in is temporarily unavailable. Please try again shortly.";

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function safeLogToken(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,32}$/u.test(value)) return fallback;
  return value;
}

export async function passwordSignInAction(
  _previousState: PasswordSignInState,
  formData: FormData
): Promise<PasswordSignInState> {
  let destination: string;
  try {
    const context = await requireTrustedMutation();
    const result = await signInWithPassword(
      formString(formData, "email"),
      formString(formData, "password"),
      context
    );
    destination = result.mustChangePassword ? APP_ROUTES.changePassword : APP_ROUTES.dashboard;
  } catch (error) {
    if (
      error instanceof LocalAuthError
      && (error.code === "invalid_credentials" || error.code === "invalid_input")
    ) {
      return { error: GENERIC_SIGN_IN_ERROR };
    }
    const rawErrorCode = typeof error === "object"
      && error !== null
      && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    console.error("[auth] Password sign-in is unavailable", {
      errorName: safeLogToken(error instanceof Error ? error.name : undefined, "UnknownError"),
      errorCode: safeLogToken(rawErrorCode)
    });
    return { error: SERVICE_UNAVAILABLE_ERROR };
  }
  redirect(destination);
}
