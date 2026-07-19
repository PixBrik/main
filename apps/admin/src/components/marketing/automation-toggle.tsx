"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  setAutomationEnabledAction,
  type MarketingActionState
} from "@/app/(admin)/marketing/actions";
import { MarketingActionFeedback } from "@/components/marketing/marketing-action-feedback";

const INITIAL_STATE: MarketingActionState = {};

function ToggleButton({ enable, disabled }: Readonly<{ enable: boolean; disabled: boolean }>) {
  const { pending } = useFormStatus();
  return <button className={`staff-button ${enable ? "staff-button-primary" : "staff-button-danger"}`} type="submit" disabled={pending || disabled}>{pending ? "Saving..." : enable ? "Enable" : "Disable"}</button>;
}

export function AutomationToggle({
  ruleId,
  enabled,
  updatedAt,
  sendingReady
}: Readonly<{ ruleId: string; enabled: boolean; updatedAt: string; sendingReady: boolean }>) {
  const [state, action] = useActionState(setAutomationEnabledAction, INITIAL_STATE);
  return (
    <form className="marketing-toggle-form" action={action}>
      <input name="ruleId" type="hidden" value={ruleId} />
      <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
      <input name="enabled" type="hidden" value={String(!enabled)} />
      <ToggleButton enable={!enabled} disabled={!enabled && !sendingReady} />
      <MarketingActionFeedback state={state} />
    </form>
  );
}
