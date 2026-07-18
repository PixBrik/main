"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  setDiscountActiveAction,
  type DiscountActionState
} from "@/app/(admin)/discounts/actions";
import { DiscountActionFeedback } from "@/components/discounts/discount-action-feedback";

const INITIAL_STATE: DiscountActionState = {};

function ToggleButton({ enable, code }: Readonly<{ enable: boolean; code: string }>) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`staff-button ${enable ? "staff-button-primary" : "staff-button-danger"}`}
      type="submit"
      disabled={pending}
      aria-label={`${enable ? "Enable" : "Disable"} discount ${code}`}
    >
      {pending ? "Saving…" : enable ? "Enable" : "Disable"}
    </button>
  );
}

export function DiscountToggleForm({
  couponId,
  code,
  updatedAt,
  active
}: Readonly<{ couponId: string; code: string; updatedAt: string; active: boolean }>) {
  const [state, action] = useActionState(setDiscountActiveAction, INITIAL_STATE);
  const enable = !active;

  return (
    <form className="discount-toggle-form" action={action}>
      <input name="couponId" type="hidden" value={couponId} />
      <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
      <input name="active" type="hidden" value={String(enable)} />
      <ToggleButton enable={enable} code={code} />
      <DiscountActionFeedback state={state} />
    </form>
  );
}
