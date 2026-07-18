"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  confirmStaffMutationPasswordAction,
  type StaffActionState
} from "@/app/(admin)/settings/users/actions";
import { ActionFeedback } from "@/components/staff/action-feedback";

const INITIAL_STATE: StaffActionState = {};

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button className="staff-button staff-button-primary" type="submit" disabled={pending}>
      {pending ? "Confirming…" : "Unlock changes"}
    </button>
  );
}

export function StaffMutationUnlock({ unlocked }: Readonly<{ unlocked: boolean }>) {
  const [state, action] = useActionState(confirmStaffMutationPasswordAction, INITIAL_STATE);

  if (unlocked) {
    return (
      <section className="staff-unlock staff-unlock-ready" aria-label="Sensitive changes unlocked">
        <div>
          <span className="eyebrow">Recent password confirmed</span>
          <strong>Sensitive changes are unlocked for this session.</strong>
          <p>The confirmation expires automatically after ten minutes.</p>
        </div>
        <StatusMark />
      </section>
    );
  }

  return (
    <section className="staff-unlock" aria-labelledby="unlock-admin-changes-title">
      <div>
        <span className="eyebrow">Security check</span>
        <h2 id="unlock-admin-changes-title">Confirm your password to make changes</h2>
        <p>You can review access now. Creating, resetting, suspending, restoring, removing, or changing roles requires a recent password confirmation.</p>
      </div>
      <form className="staff-unlock-form" action={action}>
        <label htmlFor="staff-confirm-password">Your current password</label>
        <div className="staff-inline-field">
          <input
            id="staff-confirm-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            aria-invalid={state.status === "error" ? true : undefined}
            aria-describedby={state.message ? "staff-confirm-feedback" : undefined}
            required
          />
          <ConfirmButton />
        </div>
        <div id="staff-confirm-feedback">
          <ActionFeedback state={state} />
        </div>
      </form>
    </section>
  );
}

function StatusMark() {
  return <span className="staff-unlock-mark" aria-hidden="true">OK</span>;
}
