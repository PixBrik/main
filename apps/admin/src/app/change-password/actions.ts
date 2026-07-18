"use server";

import { redirect } from "next/navigation";

import { requirePasswordChangePrincipal } from "@/lib/auth";
import { changeCurrentPassword, LocalAuthError } from "@/lib/auth/password-session";
import { requireTrustedMutation } from "@/lib/auth/request-security";
import { APP_ROUTES } from "@/lib/routes";

export type ChangePasswordState = Readonly<{
  error?: string;
}>;

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function changePasswordAction(
  _previousState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const principal = await requirePasswordChangePrincipal();
  if (principal.provider !== "password") redirect(APP_ROUTES.dashboard);

  const currentPassword = formString(formData, "currentPassword");
  const newPassword = formString(formData, "newPassword");
  const confirmation = formString(formData, "confirmation");
  if (newPassword !== confirmation) return { error: "The new passwords do not match." };

  try {
    const context = await requireTrustedMutation();
    await changeCurrentPassword(currentPassword, newPassword, context);
  } catch (error) {
    if (error instanceof LocalAuthError) return { error: error.message };
    return { error: "The password could not be changed. Please sign in and try again." };
  }
  redirect(APP_ROUTES.dashboard);
}
