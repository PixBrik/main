import { isAuthorizedBackendBridgeRequest } from "@/lib/backend-bridge";
import { withDatabaseRole, type RuntimeDatabaseRole } from "@/lib/db";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

// Temporary split-brain probe: each pool reports which database it sees and
// how many library rows survive its RLS view. Remove once the catalog
// discrepancy is diagnosed.
async function roleView(role: RuntimeDatabaseRole): Promise<Record<string, unknown>> {
  try {
    return await withDatabaseRole(role, async (sql) => {
      const [database] = await sql<{ name: string }[]>`SELECT current_database()::text AS name`;
      const [counts] = await sql<{ catalog_rows: string; items: string; published_items: string }[]>`
        SELECT
          (SELECT count(*) FROM pixbrik.model_library_item) AS items,
          (SELECT count(*) FROM pixbrik.model_library_item WHERE status = 'published') AS published_items,
          (
            SELECT count(*)
            FROM pixbrik.model_library_item item
            JOIN pixbrik.model_category category ON category.id = item.category_id
            JOIN pixbrik.model_library_version version ON version.item_id = item.id
            JOIN pixbrik.build_version build_version ON build_version.id = version.build_version_id
            WHERE item.status = 'published'
              AND version.status = 'published'
              AND category.enabled
          ) AS catalog_rows
      `;
      const [sample] = await sql<{ library: unknown; snap_keys: string[] | null; snap_type: string | null }[]>`
        SELECT
          build_version.configuration_snapshot -> 'library' AS library,
          jsonb_typeof(build_version.configuration_snapshot) AS snap_type,
          CASE WHEN jsonb_typeof(build_version.configuration_snapshot) = 'object'
            THEN (SELECT array_agg(k) FROM jsonb_object_keys(build_version.configuration_snapshot) AS k)
            ELSE NULL
          END AS snap_keys
        FROM pixbrik.model_library_item item
        JOIN pixbrik.model_library_version version ON version.item_id = item.id
        JOIN pixbrik.build_version build_version ON build_version.id = version.build_version_id
        WHERE item.status = 'published' AND version.status = 'published'
        LIMIT 1
      `;
      const library = sample?.library as Record<string, unknown> | null | undefined;
      return {
        catalogRows: Number(counts?.catalog_rows ?? -1),
        database: database?.name ?? "unknown",
        items: Number(counts?.items ?? -1),
        publishedItems: Number(counts?.published_items ?? -1),
        sampleLibrary: {
          contractVersion: library && typeof library === "object" ? library.contractVersion : null,
          isArray: Array.isArray(library),
          kind: library && typeof library === "object" ? library.kind : null,
          meshHost: (() => {
            try {
              return new URL(String((library as Record<string, unknown>)?.meshUrl ?? "")).hostname;
            } catch {
              return null;
            }
          })(),
          preview: typeof library === "string" ? (library as string).slice(0, 80) : null,
          snapKeys: sample?.snap_keys ?? null,
          snapType: sample?.snap_type ?? null,
          type: typeof library
        }
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "probe failed" };
  }
}

// Temporary one-time repair: earlier publishes stored double-encoded jsonb
// (jsonb strings, not objects). Locked build_version rows are immutable, so
// corrected copies are inserted and the library versions repointed; the other
// affected tables are updated in place. Idempotent — remove with diagnostics.
async function repairDoubleEncodedLibrary(): Promise<Record<string, unknown>> {
  try {
    return await withDatabaseRole("admin", async (sql) => {
      const repointed = await sql<{ id: string }[]>`
        WITH broken AS (
          SELECT version.id AS library_version_id, source.id AS old_build_version_id, source.build_id
          FROM pixbrik.model_library_version version
          JOIN pixbrik.build_version source ON source.id = version.build_version_id
          WHERE jsonb_typeof(source.configuration_snapshot) = 'string'
        ),
        fixed AS (
          INSERT INTO pixbrik.build_version (
            build_id, version_number, status, model_asset_id, preview_asset_id, provider,
            provider_job_id, conversion_engine_version, catalog_release, configuration_snapshot,
            bom_snapshot, width_mm, height_mm, depth_mm, brick_count, base_price_eur_minor,
            created_by, approved_by, approved_at, locked_at
          )
          SELECT source.build_id,
            (SELECT max(other.version_number) FROM pixbrik.build_version other WHERE other.build_id = source.build_id) + 1,
            source.status, source.model_asset_id, source.preview_asset_id, source.provider,
            source.provider_job_id, source.conversion_engine_version, source.catalog_release,
            (source.configuration_snapshot #>> '{}')::jsonb,
            CASE WHEN jsonb_typeof(source.bom_snapshot) = 'string'
              THEN (source.bom_snapshot #>> '{}')::jsonb ELSE source.bom_snapshot END,
            source.width_mm, source.height_mm, source.depth_mm, source.brick_count,
            source.base_price_eur_minor, source.created_by, source.approved_by,
            source.approved_at, source.locked_at
          FROM pixbrik.build_version source
          JOIN broken ON broken.old_build_version_id = source.id
          RETURNING id, build_id
        )
        UPDATE pixbrik.model_library_version version
        SET build_version_id = fixed.id
        FROM broken
        JOIN fixed ON fixed.build_id = broken.build_id
        WHERE version.id = broken.library_version_id
        RETURNING version.id::text AS id
      `;
      const titles = await sql`
        UPDATE pixbrik.model_library_item
        SET localized_title = (localized_title #>> '{}')::jsonb
        WHERE jsonb_typeof(localized_title) = 'string'
      `;
      const descriptions = await sql`
        UPDATE pixbrik.model_library_item
        SET localized_description = (localized_description #>> '{}')::jsonb
        WHERE jsonb_typeof(localized_description) = 'string'
      `;
      const categories = await sql`
        UPDATE pixbrik.model_category
        SET localized_name = (localized_name #>> '{}')::jsonb
        WHERE jsonb_typeof(localized_name) = 'string'
      `;
      const assets = await sql`
        UPDATE pixbrik.stored_asset
        SET metadata = (metadata #>> '{}')::jsonb
        WHERE jsonb_typeof(metadata) = 'string'
      `;
      return {
        assetsRepaired: assets.count,
        categoriesRepaired: categories.count,
        descriptionsRepaired: descriptions.count,
        titlesRepaired: titles.count,
        versionsRepointed: repointed.length
      };
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "repair failed" };
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedBackendBridgeRequest(request)) {
    return Response.json(
      { code: "not_found", status: "unavailable" },
      { status: 404, headers: responseHeaders }
    );
  }

  try {
    const rows = await withDatabaseRole("service", (sql) => sql<{ connected: number }[]>`
      SELECT 1::integer AS connected
    `);
    if (rows[0]?.connected !== 1) throw new Error("Database readiness check failed");

    return Response.json(
      {
        contractVersion: 1,
        database: "connected",
        diagnostics: {
          repair: await repairDoubleEncodedLibrary(),
          admin: await roleView("admin"),
          service: await roleView("service")
        },
        service: "pixbrik-backoffice",
        status: "ready"
      },
      { headers: responseHeaders }
    );
  } catch {
    return Response.json(
      { code: "backend_not_ready", status: "unavailable" },
      { status: 503, headers: responseHeaders }
    );
  }
}
