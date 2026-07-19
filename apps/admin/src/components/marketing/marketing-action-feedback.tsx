"use client";

import type { MarketingActionState } from "@/app/(admin)/marketing/actions";

export function MarketingActionFeedback({ state }: Readonly<{ state: MarketingActionState }>) {
  if (!state.message) return null;
  return (
    <p className={`staff-message ${state.status === "error" ? "staff-message-error" : "staff-message-success"}`} role={state.status === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}
