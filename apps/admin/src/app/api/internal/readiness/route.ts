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
      return {
        catalogRows: Number(counts?.catalog_rows ?? -1),
        database: database?.name ?? "unknown",
        items: Number(counts?.items ?? -1),
        publishedItems: Number(counts?.published_items ?? -1)
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
