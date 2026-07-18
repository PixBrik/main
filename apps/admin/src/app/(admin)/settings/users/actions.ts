"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth";
import {
  createStaffUser,
  LocalAuthError,
  markCurrentSessionReauthenticated,
  removeStaffUserAccess,
  resetStaffPassword,
  restoreStaffUser,
  setStaffUserRoles,
  suspendStaffUser
} from "@/lib/auth/password-session";
import { requireTrustedMutation } from "@/lib/auth/request-security";
import { APP_ROUTES } from "@/lib/routes";

export type StaffActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
  temporaryPassword?: string;
  temporaryPasswordExpiresAt?: string;
}>;

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function actionError(error: unknown, fallback: string): StaffActionState {
  if (error instanceof LocalAuthError) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: fallback };
}

function refreshStaffUsers(): void {
  try {
    revalidatePath(APP_ROUTES.users);
  } catch {
    // The database mutation has already committed. A cache refresh failure
    // must never hide a generated temporary password or report a false failure.
  }
}

export async function confirmStaffMutationPasswordAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  try {
    const context = await requireTrustedMutation();
    await markCurrentSessionReauthenticated(formString(formData, "currentPassword"), context);
  } catch (error) {
    return actionError(error, "Your password could not be confirmed. Please try again.");
  }

  refreshStaffUsers();
  redirect(APP_ROUTES.users);
}

export async function createStaffUserAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  let result: Awaited<ReturnType<typeof createStaffUser>>;
  try {
    const context = await requireTrustedMutation();
    result = await createStaffUser(
      formString(formData, "email"),
      formString(formData, "displayName"),
      formData.getAll("roles").filter((role): role is string => typeof role === "string"),
      context
    );
  } catch (error) {
    return actionError(error, "The admin account could not be created.");
  }
  refreshStaffUsers();
  return {
    status: "success",
    message: "Admin access created. Share the temporary password through a private channel.",
    temporaryPassword: result.temporaryPassword,
    temporaryPasswordExpiresAt: result.expiresAt.toISOString()
  };
}

export async function resetStaffPasswordAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  let result: Awaited<ReturnType<typeof resetStaffPassword>>;
  try {
    const context = await requireTrustedMutation();
    result = await resetStaffPassword(
      formString(formData, "targetUserId"),
      formString(formData, "expectedPasswordVersion"),
      context
    );
  } catch (error) {
    return actionError(
      error,
      "The password changed in another session. Refresh the user list and try again."
    );
  }
  refreshStaffUsers();
  return {
    status: "success",
    message: "Password reset. Existing sessions were revoked and a new password is required at sign-in.",
    temporaryPassword: result.temporaryPassword,
    temporaryPasswordExpiresAt: result.expiresAt.toISOString()
  };
}

export async function setStaffUserRolesAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  try {
    const context = await requireTrustedMutation();
    await setStaffUserRoles(
      formString(formData, "targetUserId"),
      formData.getAll("roles").filter((role): role is string => typeof role === "string"),
      context
    );
  } catch (error) {
    return actionError(error, "The role assignment could not be updated.");
  }
  refreshStaffUsers();
  return { status: "success", message: "Roles updated." };
}

export async function suspendStaffUserAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  try {
    const context = await requireTrustedMutation();
    await suspendStaffUser(
      formString(formData, "targetUserId"),
      formString(formData, "reason"),
      context
    );
  } catch (error) {
    return actionError(error, "Access could not be suspended.");
  }
  refreshStaffUsers();
  return { status: "success", message: "Access suspended and active sessions revoked." };
}

export async function restoreStaffUserAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  try {
    const context = await requireTrustedMutation();
    await restoreStaffUser(formString(formData, "targetUserId"), context);
  } catch (error) {
    return actionError(error, "Access could not be restored.");
  }
  refreshStaffUsers();
  return { status: "success", message: "Admin access restored." };
}

export async function removeStaffUserAccessAction(
  _previousState: StaffActionState,
  formData: FormData
): Promise<StaffActionState> {
  await requirePermission("staff.manage");

  try {
    const context = await requireTrustedMutation();
    await removeStaffUserAccess(
      formString(formData, "targetUserId"),
      formString(formData, "reason"),
      context
    );
  } catch (error) {
    return actionError(error, "Access could not be removed.");
  }
  refreshStaffUsers();
  return {
    status: "success",
    message: "Access removed. The audit record and linked business history were retained."
  };
}
