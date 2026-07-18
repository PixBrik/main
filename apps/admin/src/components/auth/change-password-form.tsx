"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  changePasswordAction,
  type ChangePasswordState
} from "@/app/change-password/actions";

const INITIAL_STATE: ChangePasswordState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-link auth-submit" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Set new password"}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, INITIAL_STATE);
  return (
    <form className="auth-form" action={formAction}>
      <div className="field-stack">
        <label htmlFor="current-password">Current or temporary password</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
        />
      </div>
      <div className="field-stack">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={128}
          aria-describedby="password-guidance"
          required
        />
      </div>
      <p className="field-help" id="password-guidance">
        Use a memorable passphrase of 15–128 characters. Spaces and password managers are supported.
      </p>
      <div className="field-stack">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={128}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "change-password-error" : undefined}
        />
      </div>
      {state.error ? (
        <p className="form-message form-error" id="change-password-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
