import { unsubscribeMarketing, validUnsubscribeToken } from "@/lib/email/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!validUnsubscribeToken(token)) {
    return Response.json({ ok: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await unsubscribeMarketing(token, "rfc8058.one_click");
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
