export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "pixbrik-admin",
      timestamp: new Date().toISOString()
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
