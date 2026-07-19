import "server-only";

import type { TransactionSql } from "postgres";

import { withDatabaseRole } from "@/lib/db";
import type { LibraryStudioClaims } from "@/lib/library-studio-session";

const CATEGORIES = new Set([
  "aircraft", "animal", "arcade", "car", "flower", "gift", "heart", "holiday",
  "object", "plant", "space"
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HEX_PATTERN = /^#[A-Fa-f0-9]{6}$/u;
const PROVIDER_JOB_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;

export type PublicLibraryEntry = Readonly<{
  brickPreviews?: string[];
  category: string;
  defaultColor: string;
  id: string;
  meshUrl: string;
  name: string;
  seed: false;
  tags: string[];
  thumbnailUrl?: string;
}>;

type AssetInput = Readonly<{
  bytes: number;
  sha256: string;
  url: string;
}>;

export type PublishLibraryMasterInput = Readonly<{
  brickPreviews?: readonly AssetInput[];
  category: string;
  defaultColor: string;
  kit: Readonly<{
    colorCount: number;
    depthMm: number;
    heightMm: number;
    parts: number;
    priceEur: number;
    widthMm: number;
  }>;
  mesh: AssetInput;
  name: string;
  provider: "meshy" | "sample";
  providerJobId?: string;
  tags: string[];
  thumbnail?: AssetInput;
}>;

type CatalogRow = {
  category: string;
  id: string;
  library: unknown;
  name: string;
};

class LibraryPublishError extends Error {
  readonly status = 400;
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/gu, " ");
  return cleaned && Array.from(cleaned).length <= maximum ? cleaned : null;
}

function slugify(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 90);
  return slug.length >= 2 ? slug : `model-${Buffer.from(value).toString("hex").slice(0, 12)}`;
}

function categoryLabel(slug: string): string {
  return slug.replace(/-/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function positiveInteger(value: unknown, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value
    : null;
}

function safePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? Number(value.toFixed(2))
    : null;
}

function blobAsset(value: unknown, label: string): AssetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LibraryPublishError(`${label} is required.`);
  const candidate = value as Partial<AssetInput>;
  let url: URL;
  try {
    url = new URL(candidate.url ?? "");
  } catch {
    throw new LibraryPublishError(`${label} URL is invalid.`);
  }
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".public.blob.vercel-storage.com")
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new LibraryPublishError(`${label} must be a PixBrik public Blob asset.`);
  const bytes = positiveInteger(candidate.bytes, 100 * 1024 * 1024);
  if (!bytes || typeof candidate.sha256 !== "string" || !SHA256_PATTERN.test(candidate.sha256)) {
    throw new LibraryPublishError(`${label} metadata is invalid.`);
  }
  return { bytes, sha256: candidate.sha256, url: url.toString() };
}

export function parsePublishLibraryMasterInput(value: unknown): PublishLibraryMasterInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LibraryPublishError("A publish body is required.");
  const body = value as Record<string, unknown>;
  const name = cleanText(body.name, 160);
  const category = cleanText(body.category, 40)?.toLowerCase() ?? "";
  const defaultColor = cleanText(body.defaultColor, 7) ?? "";
  const provider = body.provider === "meshy" || body.provider === "sample" ? body.provider : null;
  const providerJobId = body.providerJobId === undefined ? undefined : cleanText(body.providerJobId, 64) ?? undefined;
  if (!name) throw new LibraryPublishError("A product name is required.");
  if (!CATEGORIES.has(category)) throw new LibraryPublishError("Choose a supported product category.");
  if (!HEX_PATTERN.test(defaultColor)) throw new LibraryPublishError("Choose a valid default colour.");
  if (!provider || (providerJobId && !PROVIDER_JOB_PATTERN.test(providerJobId))) {
    throw new LibraryPublishError("The source provider metadata is invalid.");
  }
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => cleanText(tag, 40)?.toLowerCase()).filter((tag): tag is string => Boolean(tag)))].slice(0, 12)
    : [];
  const kit = body.kit && typeof body.kit === "object" && !Array.isArray(body.kit)
    ? body.kit as Record<string, unknown>
    : {};
  const parsedKit = {
    colorCount: positiveInteger(kit.colorCount, 1_000),
    depthMm: positiveInteger(kit.depthMm, 100_000),
    heightMm: positiveInteger(kit.heightMm, 100_000),
    parts: positiveInteger(kit.parts, 1_000_000),
    priceEur: safePrice(kit.priceEur),
    widthMm: positiveInteger(kit.widthMm, 100_000)
  };
  if (Object.values(parsedKit).some((entry) => entry === null)) {
    throw new LibraryPublishError("The inspected brick-kit metadata is incomplete.");
  }
  const brickPreviews = body.brickPreviews === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(body.brickPreviews) || body.brickPreviews.length === 0 || body.brickPreviews.length > 12) {
        throw new LibraryPublishError("Brick previews must be a set of 1-12 rendered frames.");
      }
      return body.brickPreviews.map((frame, index) => blobAsset(frame, `Brick preview ${index + 1}`));
    })();
  return {
    brickPreviews,
    category,
    defaultColor: defaultColor.toUpperCase(),
    kit: parsedKit as PublishLibraryMasterInput["kit"],
    mesh: blobAsset(body.mesh, "Mesh"),
    name,
    provider,
    providerJobId,
    tags: [...new Set([category, "realistic", ...tags])],
    thumbnail: body.thumbnail === undefined ? undefined : blobAsset(body.thumbnail, "Thumbnail")
  };
}

function publicMetadata(value: unknown, fallback: Pick<CatalogRow, "category" | "id" | "name">): PublicLibraryEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (metadata.contractVersion !== 1 || metadata.kind !== "realistic-mesh") return null;
  const meshUrl = cleanText(metadata.meshUrl, 2_000);
  const thumbnailUrl = cleanText(metadata.thumbnailUrl, 2_000) ?? undefined;
  const defaultColor = cleanText(metadata.defaultColor, 7) ?? "";
  if (!meshUrl || !HEX_PATTERN.test(defaultColor)) return null;
  try {
    const mesh = new URL(meshUrl);
    if (mesh.protocol !== "https:" || !mesh.hostname.endsWith(".public.blob.vercel-storage.com")) return null;
    if (thumbnailUrl) {
      const thumbnail = new URL(thumbnailUrl);
      if (thumbnail.protocol !== "https:" || !thumbnail.hostname.endsWith(".public.blob.vercel-storage.com")) return null;
    }
  } catch {
    return null;
  }
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
    : [fallback.category, "realistic"];
  const brickPreviews = Array.isArray(metadata.brickPreviews)
    ? metadata.brickPreviews
      .filter((frame): frame is string => typeof frame === "string")
      .filter((frame) => {
        try {
          const parsed = new URL(frame);
          return parsed.protocol === "https:" && parsed.hostname.endsWith(".public.blob.vercel-storage.com");
        } catch {
          return false;
        }
      })
      .slice(0, 12)
    : [];
  return {
    ...(brickPreviews.length ? { brickPreviews } : {}),
    category: fallback.category,
    defaultColor: defaultColor.toUpperCase(),
    id: fallback.id,
    meshUrl,
    name: fallback.name,
    seed: false,
    tags,
    ...(thumbnailUrl ? { thumbnailUrl } : {})
  };
}

export async function listPublishedLibrary(): Promise<PublicLibraryEntry[]> {
  return withDatabaseRole("service", async (sql) => {
    const rows = await sql<CatalogRow[]>`
      SELECT DISTINCT ON (item.id)
        item.slug AS id,
        COALESCE(item.localized_title ->> 'en', item.slug) AS name,
        category.slug AS category,
        build_version.configuration_snapshot -> 'library' AS library
      FROM pixbrik.model_library_item item
      JOIN pixbrik.model_category category ON category.id = item.category_id
      JOIN pixbrik.model_library_version version ON version.item_id = item.id
      JOIN pixbrik.build_version build_version ON build_version.id = version.build_version_id
      WHERE item.status = 'published'
        AND version.status = 'published'
        AND category.enabled
      ORDER BY item.id, version.version_number DESC
    `;
    return rows
      .map((row) => publicMetadata(row.library, row))
      .filter((entry): entry is PublicLibraryEntry => Boolean(entry));
  });
}

async function ensureAsset(
  sql: TransactionSql,
  actorUserId: string,
  asset: AssetInput,
  contentType: "model/gltf-binary" | "image/png"
): Promise<string> {
  const pathname = new URL(asset.url).pathname.replace(/^\/+/, "");
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO pixbrik.stored_asset (
      owner_user_id, storage_provider, object_key, original_filename, content_type,
      byte_size, sha256, status, is_private, metadata
    ) VALUES (
      ${actorUserId}::uuid, 'vercel_blob', ${pathname}, ${pathname.split("/").at(-1) ?? pathname},
      ${contentType}, ${asset.bytes}, ${asset.sha256}, 'clean', false,
      ${JSON.stringify({ public_url: asset.url, purpose: "model_library_master" })}::text::jsonb
    )
    ON CONFLICT (object_key) DO NOTHING
    RETURNING id::text
  `;
  if (inserted[0]?.id) return inserted[0].id;
  const existing = await sql<{ id: string; byte_size: string | number | bigint; sha256: string; content_type: string }[]>`
    SELECT id::text, byte_size, sha256, content_type
    FROM pixbrik.stored_asset
    WHERE object_key = ${pathname}
    LIMIT 1
  `;
  const row = existing[0];
  if (!row || Number(row.byte_size) !== asset.bytes || row.sha256 !== asset.sha256 || row.content_type !== contentType) {
    throw new Error("Stored library asset metadata conflict");
  }
  return row.id;
}

export async function publishLibraryMaster(
  input: PublishLibraryMasterInput,
  claims: LibraryStudioClaims
): Promise<PublicLibraryEntry> {
  return withDatabaseRole("admin", async (sql) => {
    const permission = await sql<{ allowed: boolean; subject: string | null }[]>`
      SELECT
        EXISTS (
          SELECT 1
          FROM pixbrik.app_user actor
          JOIN pixbrik.user_role assignment ON assignment.user_id = actor.id
            AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
          JOIN pixbrik.role_permission role_permission ON role_permission.role_id = assignment.role_id
          JOIN pixbrik.permission permission ON permission.id = role_permission.permission_id
          WHERE actor.id = ${claims.sub}::uuid
            AND actor.status = 'active'
            AND permission.key = 'models.publish'
        ) AS allowed,
        (SELECT external_subject FROM pixbrik.app_user WHERE id = ${claims.sub}::uuid) AS subject
    `;
    if (!permission[0]?.allowed) throw new LibraryPublishError("This Studio session no longer has publishing access.");

    const slug = slugify(input.name);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`library-studio:${slug}`}, 0))`;
    // Stringified JSON params must be typed ::text before the ::jsonb cast.
    // If the parameter itself is typed jsonb, postgres.js JSON-encodes the
    // string a second time and the column stores a jsonb string, not an object.
    const category = await sql<{ id: string }[]>`
      INSERT INTO pixbrik.model_category (slug, localized_name, sort_order, enabled)
      VALUES (${input.category}, ${JSON.stringify({ en: categoryLabel(input.category) })}::text::jsonb, 100, true)
      ON CONFLICT (slug) DO UPDATE SET enabled = true
      RETURNING id::text
    `;
    const categoryId = category[0]?.id;
    if (!categoryId) throw new Error("Category insert returned no identifier");

    const meshAssetId = await ensureAsset(sql, claims.sub, input.mesh, "model/gltf-binary");
    const thumbnailAssetId = input.thumbnail
      ? await ensureAsset(sql, claims.sub, input.thumbnail, "image/png")
      : null;
    for (const frame of input.brickPreviews ?? []) {
      await ensureAsset(sql, claims.sub, frame, "image/png");
    }

    const build = await sql<{ id: string }[]>`
      INSERT INTO pixbrik.build (owner_user_id, title, status, subject_type)
      VALUES (
        ${claims.sub}::uuid, ${input.name}, 'approved',
        ${input.category === "animal" ? "pet" : "object"}
      )
      RETURNING id::text
    `;
    const buildId = build[0]?.id;
    if (!buildId) throw new Error("Build insert returned no identifier");

    const publicEntry: PublicLibraryEntry = {
      ...(input.brickPreviews?.length ? { brickPreviews: input.brickPreviews.map((frame) => frame.url) } : {}),
      category: input.category,
      defaultColor: input.defaultColor,
      id: slug,
      meshUrl: input.mesh.url,
      name: input.name,
      seed: false,
      tags: input.tags,
      ...(input.thumbnail ? { thumbnailUrl: input.thumbnail.url } : {})
    };
    const configuration = {
      library: {
        contractVersion: 1,
        defaultColor: publicEntry.defaultColor,
        kind: "realistic-mesh",
        meshUrl: publicEntry.meshUrl,
        tags: publicEntry.tags,
        ...(publicEntry.brickPreviews ? { brickPreviews: publicEntry.brickPreviews } : {}),
        ...(publicEntry.thumbnailUrl ? { thumbnailUrl: publicEntry.thumbnailUrl } : {})
      },
      studio: {
        approvedBy: claims.sub,
        inspectedFill: "reinforced-hollow",
        sessionNonce: claims.nonce
      }
    };
    const buildVersion = await sql<{ id: string }[]>`
      INSERT INTO pixbrik.build_version (
        build_id, version_number, status, model_asset_id, preview_asset_id, provider,
        provider_job_id, conversion_engine_version, catalog_release, configuration_snapshot,
        bom_snapshot, width_mm, height_mm, depth_mm, brick_count, base_price_eur_minor,
        created_by, approved_by, approved_at, locked_at
      ) VALUES (
        ${buildId}::uuid, 1, 'published', ${meshAssetId}::uuid, ${thumbnailAssetId}::uuid,
        ${input.provider}, ${input.providerJobId ?? null}, 'mesh-fidelity-2026-07', '2026-07',
        ${JSON.stringify(configuration)}::text::jsonb,
        ${JSON.stringify({ fill: "reinforced-hollow", parts: input.kit.parts, colorCount: input.kit.colorCount })}::text::jsonb,
        ${input.kit.widthMm}, ${input.kit.heightMm}, ${input.kit.depthMm}, ${input.kit.parts},
        ${Math.round(input.kit.priceEur * 100)}, ${claims.sub}::uuid, ${claims.sub}::uuid, now(), now()
      )
      RETURNING id::text
    `;
    const buildVersionId = buildVersion[0]?.id;
    if (!buildVersionId) throw new Error("Build version insert returned no identifier");
    await sql`UPDATE pixbrik.build SET active_version_id = ${buildVersionId}::uuid WHERE id = ${buildId}::uuid`;

    const item = await sql<{ id: string }[]>`
      INSERT INTO pixbrik.model_library_item (
        category_id, slug, localized_title, localized_description, status, created_by, published_at
      ) VALUES (
        ${categoryId}::uuid, ${slug}, ${JSON.stringify({ en: input.name })}::text::jsonb,
        ${JSON.stringify({ en: "A realistic 3D master, inspected and converted into a customizable PixBrik kit." })}::text::jsonb,
        'published', ${claims.sub}::uuid, now()
      )
      ON CONFLICT (slug) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        localized_title = EXCLUDED.localized_title,
        localized_description = EXCLUDED.localized_description,
        status = 'published',
        published_at = now()
      RETURNING id::text
    `;
    const itemId = item[0]?.id;
    if (!itemId) throw new Error("Library item insert returned no identifier");
    await sql`
      UPDATE pixbrik.model_library_version
      SET status = 'retired', retired_at = now()
      WHERE item_id = ${itemId}::uuid AND status = 'published'
    `;
    const libraryVersion = await sql<{ id: string; version_number: number }[]>`
      INSERT INTO pixbrik.model_library_version (
        item_id, version_number, build_version_id, status, published_by, published_at
      )
      SELECT ${itemId}::uuid, COALESCE(max(version_number), 0) + 1, ${buildVersionId}::uuid,
        'published', ${claims.sub}::uuid, now()
      FROM pixbrik.model_library_version
      WHERE item_id = ${itemId}::uuid
      RETURNING id::text, version_number
    `;
    await sql`
      INSERT INTO pixbrik.audit_event (
        actor_user_id, actor_subject, action, target_type, target_id, after_state, metadata
      ) VALUES (
        ${claims.sub}::uuid, ${permission[0]?.subject ?? "library-studio"},
        'model_library.studio_published', 'model_library_item', ${itemId},
        ${JSON.stringify({ item: publicEntry, libraryVersion: libraryVersion[0]?.version_number ?? 1 })}::text::jsonb,
        ${JSON.stringify({ admin_module: "model_library", build_version_id: buildVersionId, session_nonce: claims.nonce })}::text::jsonb
      )
    `;
    return publicEntry;
  });
}

export { LibraryPublishError };
