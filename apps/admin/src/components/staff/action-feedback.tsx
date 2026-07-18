"use client";

import type { StaffActionState } from "@/app/(admin)/settings/users/actions";
import { TemporaryPasswordReveal } from "@/components/staff/temporary-password-reveal";

export function ActionFeedback({ state }: Readonly<{ state: StaffActionState }>) {
  if (!state.message && !state.temporaryPassword) return null;

  return (
    <div className="staff-action-feedback">
      {state.message ? (
        <p
          className={`staff-message ${state.status === "error" ? "staff-message-error" : "staff-message-success"}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
      {state.temporaryPassword ? (
        <TemporaryPasswordReveal
          password={state.temporaryPassword}
          expiresAt={state.temporaryPasswordExpiresAt}
        />
      ) : null}
    </div>
  );
}
