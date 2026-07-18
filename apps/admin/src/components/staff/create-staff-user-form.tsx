"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createStaffUserAction,
  type StaffActionState
} from "@/app/(admin)/settings/users/actions";
import { ActionFeedback } from "@/components/staff/action-feedback";

const INITIAL_STATE: StaffActionState = {};

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replaceAll("-", " ");
}

function CreateButton({ disabled }: Readonly<{ disabled: boolean }>) {
  const { pending } = useFormStatus();
  return (
    <button className="staff-button staff-button-primary" type="submit" disabled={disabled || pending}>
      {pending ? "Creating…" : "Create admin access"}
    </button>
  );
}

export function CreateStaffUserForm({
  availableRoles,
  disabled
}: Readonly<{ availableRoles: readonly string[]; disabled: boolean }>) {
  const [state, action] = useActionState(createStaffUserAction, INITIAL_STATE);

  return (
    <form className="staff-create-form" action={action} aria-describedby={disabled ? "staff-create-locked" : undefined}>
      <div className="staff-form-grid">
        <div className="staff-field">
          <label htmlFor="new-staff-name">Name</label>
          <input
            id="new-staff-name"
            name="displayName"
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            disabled={disabled}
            required
          />
        </div>
        <div className="staff-field">
          <label htmlFor="new-staff-email">Email</label>
          <input
            id="new-staff-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            disabled={disabled}
            required
          />
        </div>
      </div>
      <fieldset className="staff-role-fieldset" disabled={disabled}>
        <legend>Roles</legend>
        <div className="staff-role-options">
          {availableRoles.map((role) => (
            <label key={role}>
              <input name="roles" type="checkbox" value={role} defaultChecked={role === "operations"} />
              <span>{roleLabel(role)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {disabled ? (
        <p className="staff-locked-hint" id="staff-create-locked">Confirm your password above to create an account.</p>
      ) : null}
      <CreateButton disabled={disabled} />
      <ActionFeedback state={state} />
    </form>
  );
}
