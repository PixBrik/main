import "server-only";

import type { TransactionSql } from "postgres";

import type { AuthRequestContext } from "@/lib/auth/request-security";
import { withDatabaseRequestContext } from "@/lib/db";
import {
  AffiliateInputError,
  normalizeAffiliateUuid,
  normalizeAffiliateVersionToken,
  normalizeNewAffiliateCode,
  normalizeNewAffiliatePartner,
  type NewAffiliateCodeInput,
  type NewAffiliatePartnerInput
} from "@/lib/affiliates-validation";

export type AffiliatePartnerStatus = "applicant" | "active" | "suspended" | "closed";

export type AffiliateCode = Readonly<{
  id: string;
  partnerId: string;
  partnerName: string;
  code: string;
  destinationPath: string;
  commissionBasisPoints: number | null;
  effectiveCommissionBasisPoints: number;
  active: boolean;
  usable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  attributionCount: number;
  conversionCount: number;
  updatedAt: string;
  versionToken: string;
}>;

export type AffiliatePartner = Readonly<{
  id: string;
  publicName: string;
  contactEmail: string;
  status: AffiliatePartnerStatus;
  defaultCommissionBasisPoints: number;
  payoutCurrency: string;
  termsVersion: string | null;
  codeCount: number;
  activeCodeCount: number;
  attributionCount: number;
  conversionCount: number;
  commissionEurMinor: string;
  updatedAt: string;
  versionToken: string;
}>;

export type AffiliateOverview = Readonly<{
  partners: readonly AffiliatePartner[];
  codes: readonly AffiliateCode[];
  currencies: readonly string[];
  totalAttributions: number;
  totalConversions: number;
  totalCommissionEurMinor: string;
}>;

export type AffiliateMutationActor = Readonly<{
  userId: string;
  subject: string;
}>;

type PartnerRow = {
  id: string;
  public_name: string;
  contact_email: string;
  status: AffiliatePartnerStatus;
  default_commission_basis_points: number;
  payout_currency: string;
  terms_version: string | null;
  code_count: number;
  active_code_count: number;
  attribution_count: number;
  conversion_count: number;
  commission_eur_minor: string;
  updated_at: string;
};

type CodeRow = {
  id: string;
  partner_id: string;
  partner_name: string;
  code: string;
  destination_path: string;
  commission_basis_points: number | null;
  effective_commission_basis_points: number;
  active: boolean;
  usable: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  attribution_count: number;
  conversion_count: number;
  updated_at: string;
};

type OverviewSummaryRow = {
  attribution_count: number;
  conversion_count: number;
  commission_eur_minor: string;
};

type PartnerMutationRow = {
  id: string;
  public_name: string;
  status: AffiliatePartnerStatus;
  default_commission_basis_points: number;
  payout_currency: string;
  terms_version: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  updated_at: string;
};

type CodeMutationRow = {
  id: string;
  partner_id: string;
  partner_name: string;
  partner_status: AffiliatePartnerStatus;
  code: string;
  destination_path: string;
  commission_basis_points: number | null;
  active: boolean;
  updated_at: string;
};

type AuditRecord = Readonly<{
  action: string;
  targetType: "affiliate_partner" | "affiliate_code";
  targetId: string;
  beforeState: unknown;
  afterState: unknown;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export class AffiliateOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffiliateOperationError";
  }
}

function timestamp(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function partnerAuditState(row: PartnerMutationRow): Readonly<Record<string, unknown>> {
  return {
    publicName: row.public_name,
    status: row.status,
    defaultCommissionBasisPoints: row.default_commission_basis_points,
    payoutCurrency: row.payout_currency,
    termsVersion: row.terms_version,
    approvedBy: row.approved_by,
    approvedAt: timestamp(row.approved_at)
  };
}

function codeAuditState(row: CodeMutationRow): Readonly<Record<string, unknown>> {
  return {
    partnerId: row.partner_id,
    code: row.code,
    destinationPath: row.destination_path,
    commissionBasisPoints: row.commission_basis_points,
    active: row.active
  };
}

async function recordAudit(
  sql: TransactionSql,
  actor: AffiliateMutationActor,
  context: AuthRequestContext,
  record: AuditRecord
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
      ${actor.userId}::uuid,
      ${actor.subject.slice(0, 500)},
      ${record.action},
      ${record.targetType},
      ${record.targetId},
      ${context.requestId},
      ${context.ipDigest},
      ${context.userAgentDigest},
      ${record.beforeState === null ? null : JSON.stringify(record.beforeState)}::jsonb,
      ${JSON.stringify(record.afterState)}::jsonb,
      ${JSON.stringify({ permission: "affiliates.manage", ...record.metadata })}::jsonb
    )
  `;
}

function databaseCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

/** Returns fresh affiliate operations data; financial and code status must never be statically cached. */
export async function listAffiliateOverview(userId: string): Promise<AffiliateOverview> {
  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [partnerRows, codeRows, currencyRows, summaryRows] = await Promise.all([
      sql<PartnerRow[]>`
        SELECT
          partner.id::text,
          partner.public_name,
          partner.contact_email,
          partner.status::text,
          partner.default_commission_basis_points,
          partner.payout_currency,
          partner.terms_version,
          (
            SELECT count(*)::integer
            FROM pixbrik.affiliate_code code
            WHERE code.partner_id = partner.id
          ) AS code_count,
          (
            SELECT count(*)::integer
            FROM pixbrik.affiliate_code code
            WHERE code.partner_id = partner.id AND code.active
          ) AS active_code_count,
          (
            SELECT count(*)::integer
            FROM pixbrik.affiliate_attribution attribution
            JOIN pixbrik.affiliate_code code ON code.id = attribution.code_id
            WHERE code.partner_id = partner.id
          ) AS attribution_count,
          (
            SELECT count(*)::integer
            FROM pixbrik.affiliate_attribution attribution
            JOIN pixbrik.affiliate_code code ON code.id = attribution.code_id
            WHERE code.partner_id = partner.id AND attribution.converted_order_id IS NOT NULL
          ) AS conversion_count,
          COALESCE((
            SELECT sum(commission.commission_eur_minor)
            FROM pixbrik.affiliate_commission commission
            WHERE commission.partner_id = partner.id AND commission.status <> 'reversed'
          ), 0)::text AS commission_eur_minor,
          partner.updated_at::text AS updated_at
        FROM pixbrik.affiliate_partner partner
        ORDER BY
          CASE partner.status WHEN 'active' THEN 0 WHEN 'applicant' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
          partner.public_name ASC
        LIMIT 500
      `,
      sql<CodeRow[]>`
        SELECT
          affiliate.id::text,
          affiliate.partner_id::text,
          partner.public_name AS partner_name,
          affiliate.code,
          affiliate.destination_path,
          affiliate.commission_basis_points,
          COALESCE(affiliate.commission_basis_points, partner.default_commission_basis_points)
            AS effective_commission_basis_points,
          affiliate.active,
          (
            affiliate.active
            AND partner.status = 'active'
            AND (affiliate.starts_at IS NULL OR affiliate.starts_at <= now())
            AND (affiliate.ends_at IS NULL OR affiliate.ends_at > now())
          ) AS usable,
          affiliate.starts_at,
          affiliate.ends_at,
          count(attribution.id)::integer AS attribution_count,
          count(attribution.converted_order_id)::integer AS conversion_count,
          affiliate.updated_at::text AS updated_at
        FROM pixbrik.affiliate_code affiliate
        JOIN pixbrik.affiliate_partner partner ON partner.id = affiliate.partner_id
        LEFT JOIN pixbrik.affiliate_attribution attribution ON attribution.code_id = affiliate.id
        GROUP BY affiliate.id, partner.id
        ORDER BY affiliate.active DESC, affiliate.code ASC
        LIMIT 1_000
      `,
      sql<{ code: string }[]>`
        SELECT code
        FROM pixbrik.currency
        WHERE enabled
        ORDER BY is_base DESC, code ASC
      `,
      sql<OverviewSummaryRow[]>`
        SELECT
          (SELECT count(*) FROM pixbrik.affiliate_attribution)::integer AS attribution_count,
          (SELECT count(*) FROM pixbrik.affiliate_attribution
            WHERE converted_order_id IS NOT NULL)::integer AS conversion_count,
          (SELECT COALESCE(sum(commission_eur_minor), 0)
            FROM pixbrik.affiliate_commission
            WHERE status <> 'reversed')::text AS commission_eur_minor
      `
    ]);

    const partners = partnerRows.map((row): AffiliatePartner => ({
      id: row.id,
      publicName: row.public_name,
      contactEmail: row.contact_email,
      status: row.status,
      defaultCommissionBasisPoints: row.default_commission_basis_points,
      payoutCurrency: row.payout_currency,
      termsVersion: row.terms_version,
      codeCount: row.code_count,
      activeCodeCount: row.active_code_count,
      attributionCount: row.attribution_count,
      conversionCount: row.conversion_count,
      commissionEurMinor: row.commission_eur_minor,
      updatedAt: new Date(row.updated_at).toISOString(),
      versionToken: row.updated_at
    }));
    const codes = codeRows.map((row): AffiliateCode => ({
      id: row.id,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      code: row.code,
      destinationPath: row.destination_path,
      commissionBasisPoints: row.commission_basis_points,
      effectiveCommissionBasisPoints: row.effective_commission_basis_points,
      active: row.active,
      usable: row.usable,
      startsAt: timestamp(row.starts_at),
      endsAt: timestamp(row.ends_at),
      attributionCount: row.attribution_count,
      conversionCount: row.conversion_count,
      updatedAt: new Date(row.updated_at).toISOString(),
      versionToken: row.updated_at
    }));

    const summary = summaryRows[0] ?? {
      attribution_count: 0,
      conversion_count: 0,
      commission_eur_minor: "0"
    };

    return {
      partners,
      codes,
      currencies: currencyRows.map((row) => row.code),
      totalAttributions: summary.attribution_count,
      totalConversions: summary.conversion_count,
      totalCommissionEurMinor: summary.commission_eur_minor
    };
  });
}

export async function createAffiliatePartner(
  actor: AffiliateMutationActor,
  context: AuthRequestContext,
  input: NewAffiliatePartnerInput
): Promise<Readonly<{ id: string; publicName: string }>> {
  const normalized = normalizeNewAffiliatePartner(input);

  try {
    return await withDatabaseRequestContext("admin", { userId: actor.userId }, async (sql) => {
      const [created] = await sql<PartnerMutationRow[]>`
        INSERT INTO pixbrik.affiliate_partner (
          public_name,
          contact_email,
          status,
          default_commission_basis_points,
          payout_currency,
          terms_version
        ) VALUES (
          ${normalized.publicName},
          ${normalized.contactEmail},
          'applicant',
          ${normalized.commissionBasisPoints},
          ${normalized.payoutCurrency},
          ${normalized.termsVersion}
        )
        RETURNING
          id::text,
          public_name,
          status::text,
          default_commission_basis_points,
          payout_currency,
          terms_version,
          approved_by::text,
          approved_at,
          updated_at::text AS updated_at
      `;
      if (!created) throw new Error("Affiliate partner insert did not return a row");

      await recordAudit(sql, actor, context, {
        action: "affiliate.partner_created",
        targetType: "affiliate_partner",
        targetId: created.id,
        beforeState: null,
        afterState: partnerAuditState(created)
      });
      return { id: created.id, publicName: created.public_name };
    });
  } catch (error) {
    if (databaseCode(error) === "23503") {
      throw new AffiliateOperationError("That payout currency is no longer available. Refresh and try again.");
    }
    throw error;
  }
}

export async function setAffiliatePartnerActive(
  actor: AffiliateMutationActor,
  context: AuthRequestContext,
  partnerIdValue: string,
  versionTokenValue: string,
  desiredActive: boolean
): Promise<Readonly<{ publicName: string; changed: boolean; disabledCodeCount: number }>> {
  const partnerId = normalizeAffiliateUuid(partnerIdValue, "Partner");
  const versionToken = normalizeAffiliateVersionToken(versionTokenValue);

  return withDatabaseRequestContext("admin", { userId: actor.userId }, async (sql) => {
    const [before] = await sql<PartnerMutationRow[]>`
      SELECT
        id::text,
        public_name,
        status::text,
        default_commission_basis_points,
        payout_currency,
        terms_version,
        approved_by::text,
        approved_at,
        updated_at::text AS updated_at
      FROM pixbrik.affiliate_partner
      WHERE id = ${partnerId}::uuid
      FOR UPDATE
    `;
    if (!before) throw new AffiliateOperationError("Affiliate partner not found.");
    if (before.updated_at !== versionToken) {
      throw new AffiliateOperationError("This partner changed in another session. Refresh and try again.");
    }
    if (before.status === "closed") {
      throw new AffiliateOperationError("A closed affiliate partner cannot be reactivated.");
    }
    if (desiredActive && !before.terms_version) {
      throw new AffiliateOperationError("Record the agreed affiliate terms version before activation.");
    }

    const nextStatus: AffiliatePartnerStatus = desiredActive ? "active" : "suspended";
    if (before.status === nextStatus) {
      return { publicName: before.public_name, changed: false, disabledCodeCount: 0 };
    }

    const [after] = await sql<PartnerMutationRow[]>`
      UPDATE pixbrik.affiliate_partner
      SET
        status = ${nextStatus}::pixbrik.affiliate_partner_status,
        approved_by = CASE WHEN ${desiredActive} THEN ${actor.userId}::uuid ELSE approved_by END,
        approved_at = CASE WHEN ${desiredActive} THEN now() ELSE approved_at END
      WHERE id = ${partnerId}::uuid
      RETURNING
        id::text,
        public_name,
        status::text,
        default_commission_basis_points,
        payout_currency,
        terms_version,
        approved_by::text,
        approved_at,
        updated_at::text AS updated_at
    `;
    if (!after) throw new Error("Affiliate partner update did not return a row");

    let disabledCodeCount = 0;
    if (!desiredActive) {
      const disabledCodes = await sql<{ id: string; code: string }[]>`
        UPDATE pixbrik.affiliate_code
        SET active = false
        WHERE partner_id = ${partnerId}::uuid AND active
        RETURNING id::text, code
      `;
      disabledCodeCount = disabledCodes.length;
      for (const disabledCode of disabledCodes) {
        await recordAudit(sql, actor, context, {
          action: "affiliate.code_disabled",
          targetType: "affiliate_code",
          targetId: disabledCode.id,
          beforeState: { partnerId, code: disabledCode.code, active: true },
          afterState: { partnerId, code: disabledCode.code, active: false },
          metadata: { cause: "partner_suspended", partnerId }
        });
      }
    }

    await recordAudit(sql, actor, context, {
      action: desiredActive ? "affiliate.partner_activated" : "affiliate.partner_suspended",
      targetType: "affiliate_partner",
      targetId: partnerId,
      beforeState: partnerAuditState(before),
      afterState: partnerAuditState(after),
      metadata: { disabledCodeCount }
    });
    return { publicName: after.public_name, changed: true, disabledCodeCount };
  });
}

export async function createAffiliateCode(
  actor: AffiliateMutationActor,
  context: AuthRequestContext,
  input: NewAffiliateCodeInput
): Promise<Readonly<{ id: string; code: string }>> {
  const normalized = normalizeNewAffiliateCode(input);

  try {
    return await withDatabaseRequestContext("admin", { userId: actor.userId }, async (sql) => {
      const [partner] = await sql<{ id: string; status: AffiliatePartnerStatus }[]>`
        SELECT id::text, status::text
        FROM pixbrik.affiliate_partner
        WHERE id = ${normalized.partnerId}::uuid
        FOR SHARE
      `;
      if (!partner) throw new AffiliateOperationError("Affiliate partner not found.");
      if (partner.status !== "active") {
        throw new AffiliateOperationError("Activate the partner before creating an enabled code.");
      }

      const [created] = await sql<CodeMutationRow[]>`
        WITH inserted AS (
          INSERT INTO pixbrik.affiliate_code (
            partner_id,
            code,
            destination_path,
            commission_basis_points,
            active
          ) VALUES (
            ${normalized.partnerId}::uuid,
            ${normalized.code},
            ${normalized.destinationPath},
            ${normalized.commissionBasisPoints},
            true
          )
          RETURNING *
        )
        SELECT
          inserted.id::text,
          inserted.partner_id::text,
          partner.public_name AS partner_name,
          partner.status::text AS partner_status,
          inserted.code,
          inserted.destination_path,
          inserted.commission_basis_points,
          inserted.active,
          inserted.updated_at::text AS updated_at
        FROM inserted
        JOIN pixbrik.affiliate_partner partner ON partner.id = inserted.partner_id
      `;
      if (!created) throw new Error("Affiliate code insert did not return a row");

      await recordAudit(sql, actor, context, {
        action: "affiliate.code_created",
        targetType: "affiliate_code",
        targetId: created.id,
        beforeState: null,
        afterState: codeAuditState(created)
      });
      return { id: created.id, code: created.code };
    });
  } catch (error) {
    if (databaseCode(error) === "23505") {
      throw new AffiliateOperationError("That affiliate code already exists.");
    }
    throw error;
  }
}

export async function setAffiliateCodeActive(
  actor: AffiliateMutationActor,
  context: AuthRequestContext,
  codeIdValue: string,
  versionTokenValue: string,
  desiredActive: boolean
): Promise<Readonly<{ code: string; changed: boolean }>> {
  const codeId = normalizeAffiliateUuid(codeIdValue, "Affiliate code");
  const versionToken = normalizeAffiliateVersionToken(versionTokenValue);

  return withDatabaseRequestContext("admin", { userId: actor.userId }, async (sql) => {
    // Lock the partner before the code, matching partner suspension's lock order.
    // This prevents a concurrent code enable from racing past a partner suspension.
    const [relationship] = await sql<{
      partner_name: string;
      partner_status: AffiliatePartnerStatus;
    }[]>`
      SELECT
        partner.public_name AS partner_name,
        partner.status::text AS partner_status
      FROM pixbrik.affiliate_partner partner
      JOIN pixbrik.affiliate_code affiliate ON affiliate.partner_id = partner.id
      WHERE affiliate.id = ${codeId}::uuid
      FOR SHARE OF partner
    `;
    if (!relationship) throw new AffiliateOperationError("Affiliate code not found.");
    if (desiredActive && relationship.partner_status !== "active") {
      throw new AffiliateOperationError("Activate the partner before enabling this code.");
    }

    const [lockedCode] = await sql<{
      id: string;
      partner_id: string;
      code: string;
      destination_path: string;
      commission_basis_points: number | null;
      active: boolean;
      updated_at: string;
    }[]>`
      SELECT
        id::text,
        partner_id::text,
        code,
        destination_path,
        commission_basis_points,
        active,
        updated_at::text AS updated_at
      FROM pixbrik.affiliate_code
      WHERE id = ${codeId}::uuid
      FOR UPDATE
    `;
    if (!lockedCode) throw new AffiliateOperationError("Affiliate code not found.");
    const before: CodeMutationRow = {
      ...lockedCode,
      partner_name: relationship.partner_name,
      partner_status: relationship.partner_status
    };
    if (before.updated_at !== versionToken) {
      throw new AffiliateOperationError("This code changed in another session. Refresh and try again.");
    }
    if (before.active === desiredActive) return { code: before.code, changed: false };

    const [updated] = await sql<{
      id: string;
      partner_id: string;
      code: string;
      destination_path: string;
      commission_basis_points: number | null;
      active: boolean;
      updated_at: string;
    }[]>`
      UPDATE pixbrik.affiliate_code
      SET active = ${desiredActive}
      WHERE id = ${codeId}::uuid
      RETURNING
        id::text,
        partner_id::text,
        code,
        destination_path,
        commission_basis_points,
        active,
        updated_at::text AS updated_at
    `;
    if (!updated) throw new Error("Affiliate code update did not return a row");
    const after: CodeMutationRow = {
      ...updated,
      partner_name: before.partner_name,
      partner_status: before.partner_status
    };

    await recordAudit(sql, actor, context, {
      action: desiredActive ? "affiliate.code_enabled" : "affiliate.code_disabled",
      targetType: "affiliate_code",
      targetId: codeId,
      beforeState: codeAuditState(before),
      afterState: codeAuditState(after)
    });
    return { code: after.code, changed: true };
  });
}

export { AffiliateInputError };
