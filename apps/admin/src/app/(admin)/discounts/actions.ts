"use server";

import { revalidatePath } from "next/cache";
import type { TransactionSql } from "postgres";

import { requirePermission } from "@/lib/auth";
import {
  requireTrustedMutation,
  UntrustedMutationError,
  type AuthRequestContext
} from "@/lib/auth/request-security";
import { withDatabaseRequestContext } from "@/lib/db";
import { adminSectionRoute } from "@/lib/routes";

export type DiscountActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
}>;

type NewCoupon = Readonly<{
  code: string;
  name: string;
  kind: "percentage" | "fixed_eur";
  percentageBasisPoints: number | null;
  fixedAmountEurMinor: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  minimumSubtotalEurMinor: string | null;
  firstOrderOnly: boolean;
}>;

type CouponSnapshot = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  disabled_at: Date | null;
  updated_at: Date;
};

class DiscountValidationError extends Error {}
class StaleDiscountError extends Error {}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseDecimalMinor(raw: string, label: string, allowZero = false): string {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) {
    throw new DiscountValidationError(`${label} must use at most two decimal places.`);
  }
  const [whole, fraction = ""] = raw.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (allowZero ? minor < 0n : minor <= 0n) {
    throw new DiscountValidationError(`${label} must be greater than zero.`);
  }
  if (minor > 1_000_000_00n) {
    throw new DiscountValidationError(`${label} is above the supported limit.`);
  }
  return minor.toString();
}

function parsePercentageBasisPoints(raw: string): number {
  const minor = Number.parseInt(parseDecimalMinor(raw, "Percentage"), 10);
  if (minor > 10_000) throw new DiscountValidationError("Percentage cannot exceed 100%.");
  return minor;
}

function parseOptionalPositiveInteger(raw: string, label: string): number | null {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new DiscountValidationError(`${label} must be a whole number.`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000) {
    throw new DiscountValidationError(`${label} must be between 1 and 10,000,000.`);
  }
  return value;
}

function parseOptionalUtcDate(raw: string, label: string): Date | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    throw new DiscountValidationError(`${label} must be a valid UTC date and time.`);
  }
  const value = new Date(`${raw}:00.000Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 16) !== raw) {
    throw new DiscountValidationError(`${label} must be a valid UTC date and time.`);
  }
  return value;
}

function parseNewCoupon(formData: FormData): NewCoupon {
  const code = formString(formData, "code").toUpperCase();
  const name = formString(formData, "name");
  const kind = formString(formData, "kind");
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw new DiscountValidationError("Code must be 3–40 letters, numbers, hyphens or underscores.");
  }
  if (name.length < 2 || name.length > 120) {
    throw new DiscountValidationError("Name must be between 2 and 120 characters.");
  }
  if (kind !== "percentage" && kind !== "fixed_eur") {
    throw new DiscountValidationError("Choose a percentage or fixed EUR discount.");
  }

  const discountValue = formString(formData, "discountValue");
  const startsAt = parseOptionalUtcDate(formString(formData, "startsAt"), "Start");
  const endsAt = parseOptionalUtcDate(formString(formData, "endsAt"), "End");
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new DiscountValidationError("End must be later than start.");
  }
  if (endsAt && endsAt <= new Date()) {
    throw new DiscountValidationError("End must be in the future.");
  }

  const maxRedemptions = parseOptionalPositiveInteger(
    formString(formData, "maxRedemptions"),
    "Total redemption limit"
  );
  const maxRedemptionsPerCustomer = parseOptionalPositiveInteger(
    formString(formData, "maxRedemptionsPerCustomer"),
    "Per-customer limit"
  );
  if (
    maxRedemptions !== null
    && maxRedemptionsPerCustomer !== null
    && maxRedemptionsPerCustomer > maxRedemptions
  ) {
    throw new DiscountValidationError("Per-customer limit cannot exceed the total limit.");
  }

  const minimumSubtotal = formString(formData, "minimumSubtotal");
  return {
    code,
    name,
    kind,
    percentageBasisPoints: kind === "percentage" ? parsePercentageBasisPoints(discountValue) : null,
    fixedAmountEurMinor:
      kind === "fixed_eur" ? parseDecimalMinor(discountValue, "Fixed EUR amount") : null,
    startsAt,
    endsAt,
    maxRedemptions,
    maxRedemptionsPerCustomer,
    minimumSubtotalEurMinor: minimumSubtotal
      ? parseDecimalMinor(minimumSubtotal, "Minimum subtotal", true)
      : null,
    firstOrderOnly: formData.get("firstOrderOnly") === "on"
  };
}

function refreshDiscounts(): void {
  try {
    revalidatePath(adminSectionRoute("discounts"));
  } catch {
    // The transaction has committed. A cache refresh error must not report a false mutation failure.
  }
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function actionError(error: unknown, fallback: string): DiscountActionState {
  if (error instanceof DiscountValidationError || error instanceof StaleDiscountError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof UntrustedMutationError) {
    return { status: "error", message: "Your request could not be verified. Refresh and try again." };
  }
  if (databaseCode(error) === "23505") {
    return { status: "error", message: "That discount code already exists." };
  }
  console.error("Discount mutation failed", error);
  return { status: "error", message: fallback };
}

async function recordCouponAudit(
  sql: TransactionSql,
  principal: Awaited<ReturnType<typeof requirePermission>>,
  context: AuthRequestContext,
  action: string,
  targetId: string,
  beforeState: unknown,
  afterState: unknown
): Promise<void> {
  await sql`
    INSERT INTO pixbrik.audit_event (
      actor_user_id,
      actor_subject,
      action,
      target_type,
      target_id,
      request_id,
      ip_hash,
      user_agent,
      before_state,
      after_state,
      metadata
    ) VALUES (
      ${principal.userId}::uuid,
      ${principal.subject},
      ${action},
      'coupon',
      ${targetId},
      ${context.requestId},
      ${context.ipDigest},
      ${context.userAgentDigest},
      ${beforeState === null ? null : JSON.stringify(beforeState)}::jsonb,
      ${JSON.stringify(afterState)}::jsonb,
      ${JSON.stringify({ permission: "discounts.manage" })}::jsonb
    )
  `;
}

export async function createDiscountAction(
  _previousState: DiscountActionState,
  formData: FormData
): Promise<DiscountActionState> {
  const principal = await requirePermission("discounts.manage");

  try {
    const context = await requireTrustedMutation();
    const input = parseNewCoupon(formData);
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [created] = await sql<CouponSnapshot[]>`
        INSERT INTO pixbrik.coupon (
          code,
          name,
          kind,
          percentage_basis_points,
          fixed_amount_eur_minor,
          starts_at,
          ends_at,
          max_redemptions,
          max_redemptions_per_customer,
          minimum_subtotal_eur_minor,
          first_order_only,
          created_by
        ) VALUES (
          ${input.code},
          ${input.name},
          ${input.kind}::pixbrik.coupon_kind,
          ${input.percentageBasisPoints},
          ${input.fixedAmountEurMinor},
          ${input.startsAt},
          ${input.endsAt},
          ${input.maxRedemptions},
          ${input.maxRedemptionsPerCustomer},
          ${input.minimumSubtotalEurMinor},
          ${input.firstOrderOnly},
          ${principal.userId}::uuid
        )
        RETURNING id::text, code, name, active, disabled_at, updated_at
      `;
      if (!created) throw new Error("Coupon insert did not return a row");
      await recordCouponAudit(sql, principal, context, "coupon.created", created.id, null, created);
    });
    refreshDiscounts();
    return { status: "success", message: `${input.code} was created and is ready to manage.` };
  } catch (error) {
    return actionError(error, "The discount could not be created.");
  }
}

export async function setDiscountActiveAction(
  _previousState: DiscountActionState,
  formData: FormData
): Promise<DiscountActionState> {
  const principal = await requirePermission("discounts.manage");

  try {
    const context = await requireTrustedMutation();
    const couponId = formString(formData, "couponId");
    const expectedUpdatedAt = formString(formData, "expectedUpdatedAt");
    const activeValue = formString(formData, "active");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(couponId)) {
      throw new DiscountValidationError("Invalid discount identifier.");
    }
    if (Number.isNaN(new Date(expectedUpdatedAt).getTime())) {
      throw new DiscountValidationError("Refresh the page before changing this discount.");
    }
    if (activeValue !== "true" && activeValue !== "false") {
      throw new DiscountValidationError("Invalid discount status.");
    }
    const desiredActive = activeValue === "true";

    let code = "Discount";
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [before] = await sql<CouponSnapshot[]>`
        SELECT id::text, code, name, active, disabled_at, updated_at
        FROM pixbrik.coupon
        WHERE id = ${couponId}::uuid
        FOR UPDATE
      `;
      if (!before) throw new DiscountValidationError("Discount not found.");
      code = before.code;
      if (before.updated_at.toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
        throw new StaleDiscountError("This discount changed in another session. Refresh and try again.");
      }

      const [after] = await sql<CouponSnapshot[]>`
        UPDATE pixbrik.coupon
        SET
          active = ${desiredActive},
          disabled_at = CASE WHEN ${desiredActive} THEN NULL ELSE now() END
        WHERE id = ${couponId}::uuid
        RETURNING id::text, code, name, active, disabled_at, updated_at
      `;
      if (!after) throw new Error("Coupon update did not return a row");
      await recordCouponAudit(
        sql,
        principal,
        context,
        desiredActive ? "coupon.enabled" : "coupon.disabled",
        after.id,
        before,
        after
      );
    });
    refreshDiscounts();
    return { status: "success", message: `${code} was ${desiredActive ? "enabled" : "disabled"}.` };
  } catch (error) {
    return actionError(error, "The discount status could not be changed.");
  }
}
