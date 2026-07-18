import "server-only";

import { withDatabaseRole } from "@/lib/db";

type CountValue = string | number | bigint;
type DateValue = Date | string;

export type ModelCategory = Readonly<{
  id: string;
  parentId?: string;
  slug: string;
  name: string;
  parentName?: string;
  sortOrder: number;
  enabled: boolean;
  itemCount: number;
}>;

export type ModelLibraryItem = Readonly<{
  id: string;
  categoryId?: string;
  slug: string;
  title: string;
  description?: string;
  categoryName?: string;
  status: ModelLibraryStatus;
  versionCount: number;
  publishedVersionCount: number;
  publishedAt?: DateValue;
  updatedAt: DateValue;
}>;

export type ModelLibraryVersion = Readonly<{
  id: string;
  itemId: string;
  itemTitle: string;
  versionNumber: number;
  status: ModelLibraryStatus;
  buildVersionId: string;
  buildTitle: string;
  buildVersionNumber: number;
  buildVersionStatus: string;
  provider?: string;
  catalogRelease?: string;
  brickCount?: number;
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  publishedAt?: DateValue;
  retiredAt?: DateValue;
  createdAt: DateValue;
}>;

export type EligibleBuildVersion = Readonly<{
  id: string;
  buildId: string;
  buildTitle: string;
  versionNumber: number;
  provider?: string;
  catalogRelease?: string;
  brickCount?: number;
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
}>;

export type ModelLibraryStatus = "draft" | "review" | "published" | "retired";

export type ModelLibrarySnapshot = Readonly<{
  categories: readonly ModelCategory[];
  items: readonly ModelLibraryItem[];
  versions: readonly ModelLibraryVersion[];
  eligibleBuildVersions: readonly EligibleBuildVersion[];
}>;

type CategoryRow = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  parent_name: string | null;
  sort_order: number;
  enabled: boolean;
  item_count: CountValue;
};

type ItemRow = {
  id: string;
  category_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  category_name: string | null;
  status: ModelLibraryStatus;
  version_count: CountValue;
  published_version_count: CountValue;
  published_at: DateValue | null;
  updated_at: DateValue;
};

type VersionRow = {
  id: string;
  item_id: string;
  item_title: string;
  version_number: number;
  status: ModelLibraryStatus;
  build_version_id: string;
  build_title: string | null;
  build_version_number: number;
  build_version_status: string;
  provider: string | null;
  catalog_release: string | null;
  brick_count: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  published_at: DateValue | null;
  retired_at: DateValue | null;
  created_at: DateValue;
};

type EligibleBuildVersionRow = {
  id: string;
  build_id: string;
  build_title: string | null;
  version_number: number;
  provider: string | null;
  catalog_release: string | null;
  brick_count: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
};

function asCount(value: CountValue): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function defined<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

/**
 * Reads one fresh, internally consistent view of the model library. The admin
 * database client is initialized lazily by withDatabaseRole, so builds remain
 * safe when production credentials are unavailable at compile time.
 */
export async function getModelLibrarySnapshot(): Promise<ModelLibrarySnapshot> {
  return withDatabaseRole("admin", async (sql) => {
    const categories = await sql<CategoryRow[]>`
      SELECT
        category.id::text,
        category.parent_id::text,
        category.slug,
        COALESCE(category.localized_name ->> 'en', category.slug) AS name,
        COALESCE(parent.localized_name ->> 'en', parent.slug) AS parent_name,
        category.sort_order,
        category.enabled,
        count(item.id) AS item_count
      FROM pixbrik.model_category category
      LEFT JOIN pixbrik.model_category parent ON parent.id = category.parent_id
      LEFT JOIN pixbrik.model_library_item item ON item.category_id = category.id
      GROUP BY category.id, parent.id
      ORDER BY category.sort_order, name, category.slug
    `;

    const items = await sql<ItemRow[]>`
      SELECT
        item.id::text,
        item.category_id::text,
        item.slug,
        COALESCE(item.localized_title ->> 'en', item.slug) AS title,
        NULLIF(item.localized_description ->> 'en', '') AS description,
        COALESCE(category.localized_name ->> 'en', category.slug) AS category_name,
        item.status,
        count(version.id) AS version_count,
        count(version.id) FILTER (WHERE version.status = 'published') AS published_version_count,
        item.published_at,
        item.updated_at
      FROM pixbrik.model_library_item item
      LEFT JOIN pixbrik.model_category category ON category.id = item.category_id
      LEFT JOIN pixbrik.model_library_version version ON version.item_id = item.id
      GROUP BY item.id, category.id
      ORDER BY item.updated_at DESC, title, item.slug
    `;

    const versions = await sql<VersionRow[]>`
      SELECT
        version.id::text,
        version.item_id::text,
        COALESCE(item.localized_title ->> 'en', item.slug) AS item_title,
        version.version_number,
        version.status,
        version.build_version_id::text,
        COALESCE(build.title, 'Untitled build') AS build_title,
        build_version.version_number AS build_version_number,
        build_version.status::text AS build_version_status,
        build_version.provider,
        build_version.catalog_release,
        build_version.brick_count,
        build_version.width_mm,
        build_version.height_mm,
        build_version.depth_mm,
        version.published_at,
        version.retired_at,
        version.created_at
      FROM pixbrik.model_library_version version
      JOIN pixbrik.model_library_item item ON item.id = version.item_id
      JOIN pixbrik.build_version build_version ON build_version.id = version.build_version_id
      JOIN pixbrik.build build ON build.id = build_version.build_id
      ORDER BY item_title, version.version_number DESC
    `;

    const eligibleBuildVersions = await sql<EligibleBuildVersionRow[]>`
      SELECT
        build_version.id::text,
        build.id::text AS build_id,
        COALESCE(build.title, 'Untitled build') AS build_title,
        build_version.version_number,
        build_version.provider,
        build_version.catalog_release,
        build_version.brick_count,
        build_version.width_mm,
        build_version.height_mm,
        build_version.depth_mm
      FROM pixbrik.build_version build_version
      JOIN pixbrik.build build ON build.id = build_version.build_id
      WHERE build_version.locked_at IS NOT NULL
        AND build_version.status IN ('approved', 'published')
        AND NOT EXISTS (
          SELECT 1
          FROM pixbrik.model_library_version library_version
          WHERE library_version.build_version_id = build_version.id
        )
      ORDER BY build_version.approved_at DESC NULLS LAST, build_version.created_at DESC
      LIMIT 200
    `;

    return {
      categories: categories.map((category) => ({
        id: category.id,
        parentId: defined(category.parent_id),
        slug: category.slug,
        name: category.name,
        parentName: defined(category.parent_name),
        sortOrder: category.sort_order,
        enabled: category.enabled,
        itemCount: asCount(category.item_count)
      })),
      items: items.map((item) => ({
        id: item.id,
        categoryId: defined(item.category_id),
        slug: item.slug,
        title: item.title,
        description: defined(item.description),
        categoryName: defined(item.category_name),
        status: item.status,
        versionCount: asCount(item.version_count),
        publishedVersionCount: asCount(item.published_version_count),
        publishedAt: defined(item.published_at),
        updatedAt: item.updated_at
      })),
      versions: versions.map((version) => ({
        id: version.id,
        itemId: version.item_id,
        itemTitle: version.item_title,
        versionNumber: version.version_number,
        status: version.status,
        buildVersionId: version.build_version_id,
        buildTitle: version.build_title ?? "Untitled build",
        buildVersionNumber: version.build_version_number,
        buildVersionStatus: version.build_version_status,
        provider: defined(version.provider),
        catalogRelease: defined(version.catalog_release),
        brickCount: defined(version.brick_count),
        widthMm: defined(version.width_mm),
        heightMm: defined(version.height_mm),
        depthMm: defined(version.depth_mm),
        publishedAt: defined(version.published_at),
        retiredAt: defined(version.retired_at),
        createdAt: version.created_at
      })),
      eligibleBuildVersions: eligibleBuildVersions.map((version) => ({
        id: version.id,
        buildId: version.build_id,
        buildTitle: version.build_title ?? "Untitled build",
        versionNumber: version.version_number,
        provider: defined(version.provider),
        catalogRelease: defined(version.catalog_release),
        brickCount: defined(version.brick_count),
        widthMm: defined(version.width_mm),
        heightMm: defined(version.height_mm),
        depthMm: defined(version.depth_mm)
      }))
    };
  });
}
