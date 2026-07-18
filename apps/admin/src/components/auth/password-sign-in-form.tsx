"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  passwordSignInAction,
  type PasswordSignInState
} from "@/app/sign-in/actions";

const INITIAL_STATE: PasswordSignInState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-link auth-submit" type="submit" disabled={pending}>
      {pending ? "Checking…" : "Sign in"}
    </button>
  );
}

export function PasswordSignInForm() {
  const [state, formAction] = useActionState(passwordSignInAction, INITIAL_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <div className="field-stack">
        <label htmlFor="staff-email">Email address</label>
        <input
          id="staff-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>
      <div className="field-stack">
        <label htmlFor="staff-password">Password</label>
        <input
          id="staff-password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={1}
          maxLength={256}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "sign-in-error" : undefined}
        />
      </div>
      {state.error ? (
        <p className="form-message form-error" id="sign-in-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
