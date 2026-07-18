import { StatusBadge } from "@/components/status-badge";
import { redirect } from "next/navigation";
import { CreateStaffUserForm } from "@/components/staff/create-staff-user-form";
import { StaffMutationUnlock } from "@/components/staff/staff-mutation-unlock";
import { StaffUsersTable } from "@/components/staff/staff-users-table";
import { requirePermission } from "@/lib/auth";
import {
  hasRecentPasswordConfirmation,
  listStaffUsers,
  STAFF_ROLES
} from "@/lib/auth/password-session";
import { APP_ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function StaffUsersPage() {
  const principal = await requirePermission("staff.manage");
  if (principal.provider !== "password") redirect(APP_ROUTES.forbidden);
  const users = await listStaffUsers();
  const mutationsUnlocked = hasRecentPasswordConfirmation(principal);
  const activeCount = users.filter((user) => user.status === "active").length;
  const invitedCount = users.filter((user) => user.status === "invited").length;
  const suspendedCount = users.filter((user) => user.status === "suspended").length;
  const forcedChangeCount = users.filter((user) => user.mustChangePassword).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Settings / Access control</span>
          <h1>Manage admin users.</h1>
          <p>
            Invite trusted staff, assign only the access they need, and revoke access without
            deleting the audit trail or business records.
          </p>
        </div>
        <StatusBadge tone={mutationsUnlocked ? "ready" : "pending"}>
          {mutationsUnlocked ? "Changes unlocked" : "Confirmation required"}
        </StatusBadge>
      </div>

      <section className="grid-4" aria-label="Admin access summary">
        <article className="metric-card">
          <span className="eyebrow">Active</span>
          <strong>{activeCount}</strong>
          <small>staff accounts with access</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Invited</span>
          <strong>{invitedCount}</strong>
          <small>temporary credentials awaiting use</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Suspended</span>
          <strong>{suspendedCount}</strong>
          <small>accounts blocked from signing in</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Password change</span>
          <strong>{forcedChangeCount}</strong>
          <small>accounts that must choose a password</small>
        </article>
      </section>

      <StaffMutationUnlock unlocked={mutationsUnlocked} />

      <section className="panel" aria-labelledby="create-admin-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">New access</span>
            <h2 id="create-admin-title">Invite an admin</h2>
          </div>
          <span className="mono">Temporary password shown once</span>
        </div>
        <p className="staff-panel-copy">
          PixBrik generates the temporary password. It cannot be viewed later and the new admin
          must replace it at first sign-in.
        </p>
        <CreateStaffUserForm
          availableRoles={[...STAFF_ROLES]}
          disabled={!mutationsUnlocked}
        />
      </section>

      <section className="panel" aria-labelledby="admin-users-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Backend access</span>
            <h2 id="admin-users-title">Admin users</h2>
          </div>
          <span className="mono">{users.length} total</span>
        </div>
        <StaffUsersTable
          users={users}
          currentUserId={principal.userId}
          availableRoles={[...STAFF_ROLES]}
          mutationsUnlocked={mutationsUnlocked}
        />
      </section>
    </>
  );
}
