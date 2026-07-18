"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  removeStaffUserAccessAction,
  resetStaffPasswordAction,
  restoreStaffUserAction,
  setStaffUserRolesAction,
  suspendStaffUserAction,
  type StaffActionState
} from "@/app/(admin)/settings/users/actions";
import { ActionFeedback } from "@/components/staff/action-feedback";
import type { StaffUser } from "@/lib/auth/password-session";
import { APP_ROUTES } from "@/lib/routes";

type StaffServerAction = (
  previousState: StaffActionState,
  formData: FormData
) => Promise<StaffActionState>;

type StaffUserActionsProps = Readonly<{
  user: StaffUser;
  isSelf: boolean;
  availableRoles: readonly string[];
  mutationsUnlocked: boolean;
}>;

const INITIAL_STATE: StaffActionState = {};

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replaceAll("-", " ");
}

function ActionSubmit({ label, pendingLabel, danger = false }: Readonly<{
  label: string;
  pendingLabel: string;
  danger?: boolean;
}>) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`staff-button ${danger ? "staff-button-danger" : "staff-button-secondary"}`}
      type="submit"
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function ResetPasswordForm({ user }: Readonly<{ user: StaffUser }>) {
  const [state, action] = useActionState(resetStaffPasswordAction, INITIAL_STATE);
  return (
    <form className="staff-action-form" action={action}>
      <input type="hidden" name="targetUserId" value={user.userId} />
      <input type="hidden" name="expectedPasswordVersion" value={user.passwordVersion} />
      <div>
        <strong>Reset password</strong>
        <p>Revokes every session and creates a one-time temporary password.</p>
      </div>
      <ActionSubmit label="Reset password" pendingLabel="Resetting…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function RoleForm({ user, availableRoles }: Readonly<{
  user: StaffUser;
  availableRoles: readonly string[];
}>) {
  const [state, action] = useActionState(setStaffUserRolesAction, INITIAL_STATE);
  return (
    <form className="staff-action-form" action={action}>
      <input type="hidden" name="targetUserId" value={user.userId} />
      <fieldset className="staff-role-fieldset staff-role-fieldset-compact">
        <legend>Assigned roles</legend>
        <div className="staff-role-options">
          {availableRoles.map((role) => (
            <label key={role}>
              <input name="roles" type="checkbox" value={role} defaultChecked={user.roles.includes(role)} />
              <span>{roleLabel(role)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ActionSubmit label="Save roles" pendingLabel="Saving…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function ReasonedActionForm({
  action,
  userId,
  title,
  description,
  label,
  pendingLabel,
  danger = false
}: Readonly<{
  action: StaffServerAction;
  userId: string;
  title: string;
  description: string;
  label: string;
  pendingLabel: string;
  danger?: boolean;
}>) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const reasonId = `${label.toLowerCase().replaceAll(" ", "-")}-${userId}`;
  return (
    <form
      className="staff-action-form"
      action={formAction}
      onSubmit={(event) => {
        if (danger && !window.confirm("Remove this user's PixBrik backoffice access? This cannot be undone from this screen.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="targetUserId" value={userId} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <label htmlFor={reasonId}>Reason</label>
      <textarea id={reasonId} name="reason" minLength={5} maxLength={500} rows={2} required />
      <ActionSubmit label={label} pendingLabel={pendingLabel} danger={danger} />
      <ActionFeedback state={state} />
    </form>
  );
}

function RestoreForm({ userId }: Readonly<{ userId: string }>) {
  const [state, action] = useActionState(restoreStaffUserAction, INITIAL_STATE);
  return (
    <form className="staff-action-form" action={action}>
      <input type="hidden" name="targetUserId" value={userId} />
      <div>
        <strong>Restore access</strong>
        <p>Allows this person to sign in again with their existing password.</p>
      </div>
      <ActionSubmit label="Restore access" pendingLabel="Restoring…" />
      <ActionFeedback state={state} />
    </form>
  );
}

export function StaffUserActions({
  user,
  isSelf,
  availableRoles,
  mutationsUnlocked
}: StaffUserActionsProps) {
  if (isSelf || user.isPrimaryOwner) {
    return (
      <div className="staff-protected-actions">
        <span>{isSelf ? "Your protected account" : "Protected primary owner"}</span>
        {isSelf ? <Link className="staff-text-link" href={APP_ROUTES.changePassword}>Change my password</Link> : null}
      </div>
    );
  }

  if (user.status === "deleted") return <span className="staff-muted">Access removed</span>;

  if (!mutationsUnlocked) {
    return <span className="staff-muted">Confirm your password to manage</span>;
  }

  return (
    <details className="staff-actions-menu">
      <summary>Manage</summary>
      <div className="staff-actions-panel">
        <RoleForm user={user} availableRoles={availableRoles} />
        <ResetPasswordForm user={user} />
        {user.status === "suspended" ? (
          <RestoreForm userId={user.userId} />
        ) : (
          <ReasonedActionForm
            action={suspendStaffUserAction}
            userId={user.userId}
            title="Suspend access"
            description="Blocks sign-in immediately and revokes active sessions."
            label="Suspend access"
            pendingLabel="Suspending…"
          />
        )}
        <ReasonedActionForm
          action={removeStaffUserAccessAction}
          userId={user.userId}
          title="Remove access"
          description="Permanently removes backend access while retaining the audit trail."
          label="Remove access"
          pendingLabel="Removing…"
          danger
        />
      </div>
    </details>
  );
}
