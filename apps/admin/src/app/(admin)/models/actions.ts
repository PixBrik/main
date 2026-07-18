"use server";

import type { TransactionSql } from "postgres";
import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { requireTrustedMutation, type AuthRequestContext } from "@/lib/auth/request-security";
import type { Principal } from "@/lib/auth/types";
import { withDatabaseRole } from "@/lib/db";
import type { ModelLibraryStatus } from "@/lib/model-library";

const MODEL_LIBRARY_PATH = "/models";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LOCALES = ["en", "fr", "es", "it", "ar"] as const;

export type ModelLibraryActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
}>;

class ModelLibraryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelLibraryInputError";
  }
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeRequiredText(value: string, label: string, maximum: number): string {
  const text = value.trim().replace(/\s+/gu, " ");
  if (!text || Array.from(text).length > maximum) {
    throw new ModelLibraryInputError(`${label} is required and must be ${maximum} characters or fewer.`);
  }
  return text;
}

function normalizeOptionalText(value: string, label: string, maximum: number): string | undefined {
  const text = value.trim().replace(/\s+/gu, " ");
  if (!text) return undefined;
  if (Array.from(text).length > maximum) {
    throw new ModelLibraryInputError(`${label} must be ${maximum} characters or fewer.`);
  }
  return text;
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (slug.length < 2 || slug.length > 100 || !SLUG_PATTERN.test(slug)) {
    throw new ModelLibraryInputError("Use a 2–100 character slug with lowercase letters, numbers and single hyphens.");
  }
  return slug;
}

function normalizeUuid(value: string, label: string): string {
  const id = value.trim();
  if (!UUID_PATTERN.test(id)) throw new ModelLibraryInputError(`Select a valid ${label}.`);
  return id;
}

function normalizeOptionalUuid(value: string, label: string): string | null {
  const id = value.trim();
  return id ? normalizeUuid(id, label) : null;
}

function localizedJson(
  formData: FormData,
  prefix: string,
  label: string,
  maximum: number,
  englishRequired = true
): Record<string, string> {
  const localized: Record<string, string> = {};
  for (const locale of LOCALES) {
    const value = normalizeOptionalText(formString(formData, `${prefix}_${locale}`), `${label} (${locale.toUpperCase()})`, maximum);
    if (value) localized[locale] = value;
  }
  if (englishRequired && !localized.en) {
    throw new ModelLibraryInputError(`${label} in English is required.`);
  }
  return localized;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function actionError(error: unknown, fallback: string): ModelLibraryActionState {
  if (error instanceof ModelLibraryInputError) return { status: "error", message: error.message };
  const code = databaseErrorCode(error);
  if (code === "23505") return { status: "error", message: "That slug or library version already exists." };
  if (code === "23503") return { status: "error", message: "A selected category, item or build no longer exists. Refresh and try again." };
  if (code === "23514") return { status: "error", message: "One of the values does not meet the model-library rules." };
  return { status: "error", message: fallback };
}

function refreshModelLibrary(): void {
  try {
    revalidatePath(MODEL_LIBRARY_PATH);
  } catch {
    // The database transaction has committed; cache refresh cannot undo it.
  }
}

function actorUserId(principal: Principal): string | null {
  return UUID_PATTERN.test(principal.userId) ? principal.userId : null;
}

async function writeAuditEvent(
  sql: TransactionSql,
  principal: Principal,
  context: AuthRequestContext,
  action: string,
  targetType: string,
  targetId: string,
  beforeState: unknown,
  afterState: unknown,
  metadata: Readonly<Record<string, unknown>> = {}
): Promise<void> {
  const beforeJson = beforeState === undefined ? null : JSON.stringify(beforeState);
  const afterJson = afterState === undefined ? null : JSON.stringify(afterState);
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
      ${actorUserId(principal)}::uuid,
      ${principal.subject},
      ${action},
      ${targetType},
      ${targetId},
      ${context.requestId},
      ${context.ipDigest},
      ${context.userAgentDigest},
      ${beforeJson}::jsonb,
      ${afterJson}::jsonb,
      ${JSON.stringify({ admin_module: "model_library", ...metadata })}::jsonb
    )
  `;
}

export async function createModelCategoryAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Category created." };
  try {
    const request = await requireTrustedMutation();
    const slug = normalizeSlug(formString(formData, "slug"));
    const names = localizedJson(formData, "name", "Category name", 120);
    const parentId = normalizeOptionalUuid(formString(formData, "parentId"), "parent category");
    const sortOrderValue = formString(formData, "sortOrder").trim() || "100";
    const sortOrder = Number(sortOrderValue);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) {
      throw new ModelLibraryInputError("Sort order must be a whole number between 0 and 100,000.");
    }

    await withDatabaseRole("admin", async (sql) => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO pixbrik.model_category (parent_id, slug, localized_name, sort_order)
        VALUES (
          ${parentId}::uuid,
          ${slug},
          ${JSON.stringify(names)}::jsonb,
          ${sortOrder}
        )
        RETURNING id::text
      `;
      const id = rows[0]?.id;
      if (!id) throw new Error("Model category insert returned no identifier");
      await writeAuditEvent(sql, principal, request, "model_category.created", "model_category", id, undefined, {
        slug,
        localized_name: names,
        parent_id: parentId,
        sort_order: sortOrder,
        enabled: true
      });
    });
    result = { status: "success", message: `Category “${names.en}” created.` };
  } catch (error) {
    return actionError(error, "The category could not be created.");
  }
  refreshModelLibrary();
  return result;
}

export async function createModelItemAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Draft model created." };
  try {
    const request = await requireTrustedMutation();
    const slug = normalizeSlug(formString(formData, "slug"));
    const titles = localizedJson(formData, "title", "Model title", 160);
    const descriptions = localizedJson(formData, "description", "Description", 2_000, false);
    const categoryId = normalizeOptionalUuid(formString(formData, "categoryId"), "category");

    await withDatabaseRole("admin", async (sql) => {
      if (categoryId) {
        const category = await sql<{ enabled: boolean }[]>`
          SELECT enabled
          FROM pixbrik.model_category
          WHERE id = ${categoryId}::uuid
          LIMIT 1
        `;
        if (!category[0]) throw new ModelLibraryInputError("The selected category no longer exists.");
        if (!category[0].enabled) throw new ModelLibraryInputError("Choose an enabled category or re-enable it first.");
      }

      const rows = await sql<{ id: string }[]>`
        INSERT INTO pixbrik.model_library_item (
          category_id,
          slug,
          localized_title,
          localized_description,
          created_by
        ) VALUES (
          ${categoryId}::uuid,
          ${slug},
          ${JSON.stringify(titles)}::jsonb,
          ${JSON.stringify(descriptions)}::jsonb,
          ${actorUserId(principal)}::uuid
        )
        RETURNING id::text
      `;
      const id = rows[0]?.id;
      if (!id) throw new Error("Model item insert returned no identifier");
      await writeAuditEvent(sql, principal, request, "model_library_item.created", "model_library_item", id, undefined, {
        slug,
        localized_title: titles,
        localized_description: descriptions,
        category_id: categoryId,
        status: "draft"
      });
    });
    result = { status: "success", message: `Model “${titles.en}” created as a draft.` };
  } catch (error) {
    return actionError(error, "The model could not be created.");
  }
  refreshModelLibrary();
  return result;
}

export async function attachModelVersionAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Approved build attached." };
  try {
    const request = await requireTrustedMutation();
    const itemId = normalizeUuid(formString(formData, "itemId"), "model");
    const buildVersionId = normalizeUuid(formString(formData, "buildVersionId"), "approved build version");

    await withDatabaseRole("admin", async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`model-library-build:${buildVersionId}`}, 0))`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${itemId}, 0))`;
      const items = await sql<{ status: ModelLibraryStatus; title: string }[]>`
        SELECT status, COALESCE(localized_title ->> 'en', slug) AS title
        FROM pixbrik.model_library_item
        WHERE id = ${itemId}::uuid
        FOR UPDATE
      `;
      const item = items[0];
      if (!item) throw new ModelLibraryInputError("The selected model no longer exists.");
      if (item.status === "retired") throw new ModelLibraryInputError("Restore the retired model before adding a version.");

      const builds = await sql<{ id: string; title: string }[]>`
        SELECT build_version.id::text, COALESCE(build.title, 'Untitled build') AS title
        FROM pixbrik.build_version build_version
        JOIN pixbrik.build build ON build.id = build_version.build_id
        WHERE build_version.id = ${buildVersionId}::uuid
          AND build_version.locked_at IS NOT NULL
          AND build_version.status IN ('approved', 'published')
          AND NOT EXISTS (
            SELECT 1
            FROM pixbrik.model_library_version existing
            WHERE existing.build_version_id = build_version.id
          )
        LIMIT 1
      `;
      const build = builds[0];
      if (!build) {
        throw new ModelLibraryInputError("That build is not a locked approved version, or is already in the library.");
      }

      const rows = await sql<{ id: string; version_number: number }[]>`
        INSERT INTO pixbrik.model_library_version (
          item_id,
          version_number,
          build_version_id
        )
        SELECT
          ${itemId}::uuid,
          COALESCE(max(version_number), 0) + 1,
          ${buildVersionId}::uuid
        FROM pixbrik.model_library_version
        WHERE item_id = ${itemId}::uuid
        RETURNING id::text, version_number
      `;
      const version = rows[0];
      if (!version) throw new Error("Model version insert returned no identifier");
      await writeAuditEvent(sql, principal, request, "model_library_version.created", "model_library_version", version.id, undefined, {
        item_id: itemId,
        version_number: version.version_number,
        build_version_id: buildVersionId,
        status: "draft"
      });
      result = {
        status: "success",
        message: `${build.title} attached to ${item.title} as library version ${version.version_number}.`
      };
    });
  } catch (error) {
    return actionError(error, "The approved build could not be attached.");
  }
  refreshModelLibrary();
  return result;
}

const ITEM_TRANSITIONS: Readonly<Record<ModelLibraryStatus, readonly ModelLibraryStatus[]>> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["retired"],
  retired: ["draft"]
};

const VERSION_TRANSITIONS: Readonly<Record<ModelLibraryStatus, readonly ModelLibraryStatus[]>> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["retired"],
  retired: ["review"]
};

function normalizeStatus(value: string): ModelLibraryStatus {
  if (value === "draft" || value === "review" || value === "published" || value === "retired") return value;
  throw new ModelLibraryInputError("Choose a valid workflow status.");
}

export async function updateModelItemStatusAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Model status updated." };
  try {
    const request = await requireTrustedMutation();
    const itemId = normalizeUuid(formString(formData, "itemId"), "model");
    const nextStatus = normalizeStatus(formString(formData, "status"));

    await withDatabaseRole("admin", async (sql) => {
      const rows = await sql<{
        status: ModelLibraryStatus;
        title: string;
        published_at: Date | string | null;
        category_id: string | null;
      }[]>`
        SELECT item.status, COALESCE(item.localized_title ->> 'en', item.slug) AS title,
          item.published_at, item.category_id::text
        FROM pixbrik.model_library_item item
        WHERE item.id = ${itemId}::uuid
        FOR UPDATE
      `;
      const item = rows[0];
      if (!item) throw new ModelLibraryInputError("The model no longer exists.");
      if (!ITEM_TRANSITIONS[item.status].includes(nextStatus)) {
        throw new ModelLibraryInputError(`A model cannot move directly from ${item.status} to ${nextStatus}.`);
      }
      if (nextStatus === "published") {
        if (item.category_id !== null) {
          await sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${`model-library-category:${item.category_id}`}, 0)
            )
          `;
          const categories = await sql<{ enabled: boolean }[]>`
            SELECT enabled
            FROM pixbrik.model_category
            WHERE id = ${item.category_id}::uuid
            FOR SHARE
          `;
          if (categories[0]?.enabled !== true) {
            throw new ModelLibraryInputError("Enable the model category before publishing this model.");
          }
        }
        const publishedVersions = await sql<{ count: string | number | bigint }[]>`
          SELECT count(*) AS count
          FROM pixbrik.model_library_version
          WHERE item_id = ${itemId}::uuid AND status = 'published'
        `;
        if (Number(publishedVersions[0]?.count ?? 0) < 1) {
          throw new ModelLibraryInputError("Publish a reviewed library version before publishing the model.");
        }
      }
      if (nextStatus === "retired") {
        const retiredVersions = await sql<{
          id: string;
          published_at: Date | string | null;
          retired_at: Date | string;
        }[]>`
          UPDATE pixbrik.model_library_version
          SET status = 'retired', retired_at = now()
          WHERE item_id = ${itemId}::uuid AND status = 'published'
          RETURNING id::text, published_at, retired_at
        `;
        for (const retiredVersion of retiredVersions) {
          await writeAuditEvent(
            sql,
            principal,
            request,
            "model_library_version.auto_retired",
            "model_library_version",
            retiredVersion.id,
            { status: "published", published_at: retiredVersion.published_at, retired_at: null },
            { status: "retired", published_at: retiredVersion.published_at, retired_at: retiredVersion.retired_at },
            { cause: "model_retired", item_id: itemId }
          );
        }
      }
      const updated = await sql<{ published_at: Date | string | null }[]>`
        UPDATE pixbrik.model_library_item
        SET
          status = ${nextStatus},
          published_at = CASE
            WHEN ${nextStatus} = 'published' THEN now()
            WHEN ${nextStatus} IN ('draft', 'review') THEN NULL
            ELSE published_at
          END
        WHERE id = ${itemId}::uuid
        RETURNING published_at
      `;
      await writeAuditEvent(sql, principal, request, "model_library_item.status_changed", "model_library_item", itemId, {
        status: item.status,
        published_at: item.published_at
      }, {
        status: nextStatus,
        published_at: updated[0]?.published_at ?? null
      });
      result = { status: "success", message: `${item.title} moved to ${nextStatus}.` };
    });
  } catch (error) {
    return actionError(error, "The model status could not be changed.");
  }
  refreshModelLibrary();
  return result;
}

export async function updateModelVersionStatusAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Library version status updated." };
  try {
    const request = await requireTrustedMutation();
    const versionId = normalizeUuid(formString(formData, "versionId"), "library version");
    const nextStatus = normalizeStatus(formString(formData, "status"));

    await withDatabaseRole("admin", async (sql) => {
      const rows = await sql<{
        status: ModelLibraryStatus;
        item_id: string;
        item_status: ModelLibraryStatus;
        item_title: string;
        version_number: number;
        build_status: string;
        locked_at: Date | string | null;
        published_at: Date | string | null;
        retired_at: Date | string | null;
      }[]>`
        SELECT
          version.status,
          version.item_id::text,
          item.status AS item_status,
          COALESCE(item.localized_title ->> 'en', item.slug) AS item_title,
          version.version_number,
          build_version.status::text AS build_status,
          build_version.locked_at,
          version.published_at,
          version.retired_at
        FROM pixbrik.model_library_version version
        JOIN pixbrik.model_library_item item ON item.id = version.item_id
        JOIN pixbrik.build_version build_version ON build_version.id = version.build_version_id
        WHERE version.id = ${versionId}::uuid
        FOR UPDATE OF version, item
      `;
      const version = rows[0];
      if (!version) throw new ModelLibraryInputError("The library version no longer exists.");
      if (!VERSION_TRANSITIONS[version.status].includes(nextStatus)) {
        throw new ModelLibraryInputError(`A version cannot move directly from ${version.status} to ${nextStatus}.`);
      }
      if (nextStatus === "published") {
        if (!version.locked_at || (version.build_status !== "approved" && version.build_status !== "published")) {
          throw new ModelLibraryInputError("Only a locked approved build version can be published.");
        }
        if (version.item_status === "retired") {
          throw new ModelLibraryInputError("Restore the model before publishing one of its versions.");
        }
        const replacedVersions = await sql<{
          id: string;
          published_at: Date | string | null;
          retired_at: Date | string;
        }[]>`
          UPDATE pixbrik.model_library_version
          SET status = 'retired', retired_at = now()
          WHERE item_id = ${version.item_id}::uuid
            AND status = 'published'
            AND id <> ${versionId}::uuid
          RETURNING id::text, published_at, retired_at
        `;
        for (const replacedVersion of replacedVersions) {
          await writeAuditEvent(
            sql,
            principal,
            request,
            "model_library_version.replaced",
            "model_library_version",
            replacedVersion.id,
            { status: "published", published_at: replacedVersion.published_at, retired_at: null },
            { status: "retired", published_at: replacedVersion.published_at, retired_at: replacedVersion.retired_at },
            { replacement_version_id: versionId, item_id: version.item_id }
          );
        }
      }
      if (nextStatus === "retired" && version.item_status === "published") {
        throw new ModelLibraryInputError("Publish a replacement version or retire the model before retiring its live version.");
      }

      const updated = await sql<{ published_at: Date | string | null; retired_at: Date | string | null }[]>`
        UPDATE pixbrik.model_library_version
        SET
          status = ${nextStatus},
          published_by = CASE WHEN ${nextStatus} = 'published' THEN ${actorUserId(principal)}::uuid ELSE published_by END,
          published_at = CASE
            WHEN ${nextStatus} = 'published' THEN now()
            WHEN ${nextStatus} IN ('draft', 'review') THEN NULL
            ELSE published_at
          END,
          retired_at = CASE
            WHEN ${nextStatus} = 'retired' THEN now()
            WHEN ${nextStatus} IN ('draft', 'review', 'published') THEN NULL
            ELSE retired_at
          END
        WHERE id = ${versionId}::uuid
        RETURNING published_at, retired_at
      `;
      await writeAuditEvent(sql, principal, request, "model_library_version.status_changed", "model_library_version", versionId, {
        status: version.status,
        published_at: version.published_at,
        retired_at: version.retired_at
      }, {
        status: nextStatus,
        published_at: updated[0]?.published_at ?? null,
        retired_at: updated[0]?.retired_at ?? null
      });
      result = {
        status: "success",
        message: `${version.item_title} version ${version.version_number} moved to ${nextStatus}.`
      };
    });
  } catch (error) {
    return actionError(error, "The library version status could not be changed.");
  }
  refreshModelLibrary();
  return result;
}

export async function setModelCategoryEnabledAction(
  _previousState: ModelLibraryActionState,
  formData: FormData
): Promise<ModelLibraryActionState> {
  const principal = await requirePermission("models.publish");
  let result: ModelLibraryActionState = { status: "success", message: "Category visibility updated." };
  try {
    const request = await requireTrustedMutation();
    const categoryId = normalizeUuid(formString(formData, "categoryId"), "category");
    const enabledValue = formString(formData, "enabled");
    if (enabledValue !== "true" && enabledValue !== "false") {
      throw new ModelLibraryInputError("Choose whether the category is enabled.");
    }
    const enabled = enabledValue === "true";

    await withDatabaseRole("admin", async (sql) => {
      await sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`model-library-category:${categoryId}`}, 0)
        )
      `;
      const rows = await sql<{ enabled: boolean; name: string }[]>`
        SELECT enabled, COALESCE(localized_name ->> 'en', slug) AS name
        FROM pixbrik.model_category
        WHERE id = ${categoryId}::uuid
        FOR UPDATE
      `;
      const category = rows[0];
      if (!category) throw new ModelLibraryInputError("The category no longer exists.");
      if (category.enabled === enabled) {
        result = { status: "success", message: `${category.name} is already ${enabled ? "enabled" : "disabled"}.` };
        return;
      }
      if (!enabled) {
        const published = await sql<{ count: string | number | bigint }[]>`
          SELECT count(*) AS count
          FROM pixbrik.model_library_item
          WHERE category_id = ${categoryId}::uuid AND status = 'published'
        `;
        if (Number(published[0]?.count ?? 0) > 0) {
          throw new ModelLibraryInputError("Move published models out of this category or retire them before disabling it.");
        }
      }
      await sql`
        UPDATE pixbrik.model_category
        SET enabled = ${enabled}
        WHERE id = ${categoryId}::uuid
      `;
      await writeAuditEvent(sql, principal, request, "model_category.visibility_changed", "model_category", categoryId, {
        enabled: category.enabled
      }, { enabled });
      result = { status: "success", message: `${category.name} ${enabled ? "enabled" : "disabled"}.` };
    });
  } catch (error) {
    return actionError(error, "The category visibility could not be changed.");
  }
  refreshModelLibrary();
  return result;
}
