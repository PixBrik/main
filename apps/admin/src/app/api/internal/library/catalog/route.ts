import { isAuthorizedBackendBridgeRequest } from "@/lib/backend-bridge";
import { listPublishedLibrary } from "@/lib/public-model-library";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

export async function GET(request: Request) {
  if (!isAuthorizedBackendBridgeRequest(request)) {
    return Response.json({ code: "not_found" }, { status: 404, headers });
  }
  try {
    return Response.json({ contractVersion: 1, entries: await listPublishedLibrary() }, { headers });
  } catch {
    return Response.json({ code: "catalog_unavailable" }, { status: 503, headers });
  }
}
