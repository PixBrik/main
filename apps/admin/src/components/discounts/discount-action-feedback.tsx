"use client";

import type { DiscountActionState } from "@/app/(admin)/discounts/actions";

export function DiscountActionFeedback({
  state
}: Readonly<{ state: DiscountActionState }>) {
  if (!state.message) return null;

  return (
    <p
      className={`staff-message ${
        state.status === "error" ? "staff-message-error" : "staff-message-success"
      }`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}
