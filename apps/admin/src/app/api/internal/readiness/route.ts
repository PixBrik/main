import { isAuthorizedBackendBridgeRequest } from "@/lib/backend-bridge";
import { withDatabaseRole } from "@/lib/db";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

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
