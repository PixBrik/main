"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import {
  createCampaignAction,
  type MarketingActionState
} from "@/app/(admin)/marketing/actions";
import { MarketingActionFeedback } from "@/components/marketing/marketing-action-feedback";

const INITIAL_STATE: MarketingActionState = {};

type TemplateOption = Readonly<{
  key: string;
  version: number;
  label: string;
}>;

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="staff-button staff-button-primary" type="submit" disabled={pending}>{pending ? "Creating..." : "Create draft"}</button>;
}

export function CreateCampaignForm({ templates }: Readonly<{ templates: readonly TemplateOption[] }>) {
  const [state, action] = useActionState(createCampaignAction, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} className="marketing-create-form" action={action}>
      <div className="marketing-form-grid">
        <label className="staff-field"><span>Campaign name</span><input name="name" type="text" minLength={2} maxLength={120} placeholder="Holiday gift ideas" required /></label>
        <label className="staff-field"><span>Prebuilt template</span><select name="templateSelection" defaultValue="" onChange={(event) => {
          const [key, version] = event.currentTarget.value.split("|");
          const form = event.currentTarget.form;
          if (form) {
            (form.elements.namedItem("templateKey") as HTMLInputElement).value = key ?? "";
            (form.elements.namedItem("templateVersion") as HTMLInputElement).value = version ?? "";
          }
        }} required><option value="" disabled>Choose a localized template</option>{templates.map((template) => <option key={`${template.key}:${template.version}`} value={`${template.key}|${template.version}`}>{template.label}</option>)}</select></label>
        <input name="templateKey" type="hidden" />
        <input name="templateVersion" type="hidden" />
        <label className="staff-field"><span>Audience</span><select name="audienceKey" defaultValue="all_subscribers"><option value="all_subscribers">All subscribed contacts</option><option value="registered_customers">Subscribed account holders</option><option value="past_buyers">Subscribed past buyers</option><option value="no_orders">Subscribed contacts with no order</option></select></label>
      </div>
      <div className="discount-form-footer"><SubmitButton /><small>The draft cannot send until a user with send permission explicitly schedules it.</small></div>
      <MarketingActionFeedback state={state} />
    </form>
  );
}
