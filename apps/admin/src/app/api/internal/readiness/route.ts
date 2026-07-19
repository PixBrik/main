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
