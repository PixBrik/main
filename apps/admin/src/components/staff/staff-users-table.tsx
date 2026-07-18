import { BricklingAvatar } from "@/components/brickling-avatar";
import { StatusBadge } from "@/components/status-badge";
import { StaffUserActions } from "@/components/staff/staff-user-actions";
import type { StaffUser } from "@/lib/auth/password-session";

type StaffUsersTableProps = Readonly<{
  users: readonly StaffUser[];
  currentUserId: string;
  availableRoles: readonly string[];
  mutationsUnlocked: boolean;
}>;

function statusTone(status: StaffUser["status"]): "ready" | "blocked" | "pending" {
  if (status === "active") return "ready";
  if (status === "invited") return "pending";
  return "blocked";
}

function formatUtcDate(value: Date | undefined): string {
  if (!value) return "Never";
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function passwordState(user: StaffUser): string {
  if (user.status === "deleted") return "Access removed";
  if (user.credentialStatus === "retired") return "Disabled";
  if (user.credentialStatus === "pending") return "Temporary password";
  if (user.lockedUntil && user.lockedUntil > new Date()) return "Temporarily locked";
  if (user.mustChangePassword) return "Temporary password";
  return "Private password set";
}

export function StaffUsersTable({
  users,
  currentUserId,
  availableRoles,
  mutationsUnlocked
}: StaffUsersTableProps) {
  if (users.length === 0) {
    return (
      <div className="empty-state">
        <div>
          <strong>No admin users found</strong>
          <span>Create the first protected account after confirming your password.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="staff-table-scroller" role="region" aria-label="Admin users" tabIndex={0}>
      <table className="staff-table">
        <caption className="staff-sr-only">PixBrik backend users and their current access</caption>
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Roles</th>
            <th scope="col">Status</th>
            <th scope="col">Password</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.userId === currentUserId;
            const label = user.displayName ?? user.email;
            return (
              <tr key={user.userId}>
                <td>
                  <div className="staff-user-cell">
                    <BricklingAvatar seed={`staff:${user.userId}`} label={label} />
                    <div>
                      <strong>{label}</strong>
                      <span>{user.email}</span>
                      <div className="staff-inline-tags">
                        {isSelf ? <span className="staff-tag">You</span> : null}
                        {user.isPrimaryOwner ? <span className="staff-tag">Primary owner</span> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="staff-inline-tags">
                    {user.roles.map((role) => <span className="staff-role-tag" key={role}>{role}</span>)}
                  </div>
                </td>
                <td><StatusBadge tone={statusTone(user.status)}>{user.status}</StatusBadge></td>
                <td>
                  <span>{passwordState(user)}</span>
                  {user.activeSessionCount > 0 ? (
                    <small>{user.activeSessionCount} active {user.activeSessionCount === 1 ? "session" : "sessions"}</small>
                  ) : null}
                </td>
                <td><time dateTime={user.lastSignedInAt?.toISOString()}>{formatUtcDate(user.lastSignedInAt)}</time></td>
                <td>
                  <StaffUserActions
                    user={user}
                    isSelf={isSelf}
                    availableRoles={availableRoles}
                    mutationsUnlocked={mutationsUnlocked}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
