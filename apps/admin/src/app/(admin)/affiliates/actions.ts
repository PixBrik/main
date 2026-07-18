"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import {
  requireTrustedMutation,
  UntrustedMutationError
} from "@/lib/auth/request-security";
import {
  AffiliateInputError,
  AffiliateOperationError,
  createAffiliateCode,
  createAffiliatePartner,
  setAffiliateCodeActive,
  setAffiliatePartnerActive
} from "@/lib/affiliates";
import { adminSectionRoute } from "@/lib/routes";

export type AffiliateActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
}>;

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function refreshAffiliates(): void {
  try {
    revalidatePath(adminSectionRoute("affiliates"));
  } catch {
    // The mutation has committed; cache refresh failure must not report a false write failure.
  }
}

function actionError(error: unknown, fallback: string): AffiliateActionState {
  if (error instanceof AffiliateInputError || error instanceof AffiliateOperationError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof UntrustedMutationError) {
    return { status: "error", message: "Your request could not be verified. Refresh and try again." };
  }
  return { status: "error", message: fallback };
}

function desiredActive(formData: FormData): boolean {
  const value = formString(formData, "active");
  if (value !== "true" && value !== "false") {
    throw new AffiliateInputError("Invalid affiliate status. Refresh and try again.");
  }
  return value === "true";
}

export async function createAffiliatePartnerAction(
  _previousState: AffiliateActionState,
  formData: FormData
): Promise<AffiliateActionState> {
  const principal = await requirePermission("affiliates.manage");

  try {
    const context = await requireTrustedMutation();
    const created = await createAffiliatePartner(
      { userId: principal.userId, subject: principal.subject },
      context,
      {
        publicName: formString(formData, "publicName"),
        contactEmail: formString(formData, "contactEmail"),
        commissionPercent: formString(formData, "commissionPercent"),
        payoutCurrency: formString(formData, "payoutCurrency"),
        termsVersion: formString(formData, "termsVersion")
      }
    );
    refreshAffiliates();
    return {
      status: "success",
      message: `${created.publicName} was added as an applicant. Review and activate the partner before issuing a code.`
    };
  } catch (error) {
    return actionError(error, "The affiliate partner could not be created.");
  }
}

export async function setAffiliatePartnerActiveAction(
  _previousState: AffiliateActionState,
  formData: FormData
): Promise<AffiliateActionState> {
  const principal = await requirePermission("affiliates.manage");

  try {
    const context = await requireTrustedMutation();
    const active = desiredActive(formData);
    const result = await setAffiliatePartnerActive(
      { userId: principal.userId, subject: principal.subject },
      context,
      formString(formData, "partnerId"),
      formString(formData, "versionToken"),
      active
    );
    refreshAffiliates();
    if (!result.changed) {
      return { status: "success", message: `${result.publicName} was already ${active ? "active" : "suspended"}.` };
    }
    const codeMessage = !active && result.disabledCodeCount > 0
      ? ` ${result.disabledCodeCount} active code${result.disabledCodeCount === 1 ? " was" : "s were"} disabled too.`
      : "";
    return {
      status: "success",
      message: `${result.publicName} was ${active ? "activated" : "suspended"}.${codeMessage}`
    };
  } catch (error) {
    return actionError(error, "The affiliate partner status could not be changed.");
  }
}

export async function createAffiliateCodeAction(
  _previousState: AffiliateActionState,
  formData: FormData
): Promise<AffiliateActionState> {
  const principal = await requirePermission("affiliates.manage");

  try {
    const context = await requireTrustedMutation();
    const created = await createAffiliateCode(
      { userId: principal.userId, subject: principal.subject },
      context,
      {
        partnerId: formString(formData, "partnerId"),
        code: formString(formData, "code"),
        destinationPath: formString(formData, "destinationPath"),
        commissionPercent: formString(formData, "commissionPercent")
      }
    );
    refreshAffiliates();
    return { status: "success", message: `${created.code} was created and enabled.` };
  } catch (error) {
    return actionError(error, "The affiliate code could not be created.");
  }
}

export async function setAffiliateCodeActiveAction(
  _previousState: AffiliateActionState,
  formData: FormData
): Promise<AffiliateActionState> {
  const principal = await requirePermission("affiliates.manage");

  try {
    const context = await requireTrustedMutation();
    const active = desiredActive(formData);
    const result = await setAffiliateCodeActive(
      { userId: principal.userId, subject: principal.subject },
      context,
      formString(formData, "codeId"),
      formString(formData, "versionToken"),
      active
    );
    refreshAffiliates();
    return {
      status: "success",
      message: `${result.code} was ${result.changed ? (active ? "enabled" : "disabled") : `already ${active ? "enabled" : "disabled"}`}.`
    };
  } catch (error) {
    return actionError(error, "The affiliate code status could not be changed.");
  }
}
