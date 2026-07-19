import { isAuthorizedBackendBridgeRequest } from "@/lib/backend-bridge";
import { verifyLibraryStudioSession } from "@/lib/library-studio-session";
import {
  LibraryPublishError,
  parsePublishLibraryMasterInput,
  publishLibraryMaster
} from "@/lib/public-model-library";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request) {
  if (!isAuthorizedBackendBridgeRequest(request)) {
    return Response.json({ code: "not_found" }, { status: 404, headers });
  }
  const token = request.headers.get("x-pixbrik-studio-session")?.trim() ?? "";
  const claims = verifyLibraryStudioSession(token);
  if (!claims) {
    return Response.json({ code: "studio_session_expired", error: "Reopen Studio from the backoffice." }, { status: 403, headers });
  }
  try {
    const input = parsePublishLibraryMasterInput(await request.json());
    const entry = await publishLibraryMaster(input, claims);
    return Response.json({ contractVersion: 1, entry }, { headers });
  } catch (error) {
    const status = error instanceof LibraryPublishError ? error.status : 500;
    return Response.json(
      {
        code: status === 400 ? "invalid_library_master" : "library_publish_failed",
        error: error instanceof LibraryPublishError ? error.message : "The approved master could not be published."
      },
      { status, headers }
    );
  }
}
