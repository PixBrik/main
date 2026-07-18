import { AdminShell } from "@/components/admin-shell";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePermission("dashboard.read");
  return <AdminShell principal={principal}>{children}</AdminShell>;
}
