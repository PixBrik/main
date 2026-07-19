"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  changeCampaignStatusAction,
  type MarketingActionState
} from "@/app/(admin)/marketing/actions";
import { MarketingActionFeedback } from "@/components/marketing/marketing-action-feedback";

const INITIAL_STATE: MarketingActionState = {};

function ActionButton({ label, danger = false, disabled = false }: Readonly<{ label: string; danger?: boolean; disabled?: boolean }>) {
  const { pending } = useFormStatus();
  return <button className={`staff-button ${danger ? "staff-button-danger" : "staff-button-primary"}`} type="submit" disabled={pending || disabled}>{pending ? "Saving..." : label}</button>;
}

export function CampaignActions({
  campaignId,
  campaignName,
  status,
  updatedAt,
  sendingReady,
  audienceSize
}: Readonly<{
  campaignId: string;
  campaignName: string;
  status: string;
  updatedAt: string;
  sendingReady: boolean;
  audienceSize: number;
}>) {
  const [launchState, launchAction] = useActionState(changeCampaignStatusAction, INITIAL_STATE);
  const [scheduleState, scheduleAction] = useActionState(changeCampaignStatusAction, INITIAL_STATE);
  const [cancelState, cancelAction] = useActionState(changeCampaignStatusAction, INITIAL_STATE);
  const [timezoneOffset, setTimezoneOffset] = useState(0);
  const [timezoneName, setTimezoneName] = useState("UTC");
  useEffect(() => {
    setTimezoneOffset(new Date().getTimezoneOffset());
    setTimezoneName(Intl.DateTimeFormat().resolvedOptions().timeZone || "your local timezone");
  }, []);
  if (!["draft", "failed", "scheduled"].includes(status)) return null;
  return (
    <div className="marketing-campaign-actions">
      {status === "draft" ? (
        <>
          <form action={launchAction}>
            <input name="campaignId" type="hidden" value={campaignId} />
            <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
            <input name="intent" type="hidden" value="launch" />
            <input name="expectedAudienceSize" type="hidden" value={audienceSize} />
            <label className="marketing-audience-confirm"><input name="confirmAudience" type="checkbox" value="true" required disabled={!sendingReady} />Confirm {audienceSize} subscribed recipient{audienceSize === 1 ? "" : "s"}</label>
            <ActionButton label="Queue now" disabled={!sendingReady || audienceSize < 1} />
            <MarketingActionFeedback state={launchState} />
          </form>
          <form className="marketing-schedule-form" action={scheduleAction}>
            <input name="campaignId" type="hidden" value={campaignId} />
            <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
            <input name="intent" type="hidden" value="schedule" />
            <input name="expectedAudienceSize" type="hidden" value={audienceSize} />
            <input name="timezoneOffset" type="hidden" value={timezoneOffset} />
            <label><span>Schedule {campaignName} ({timezoneName})</span><input name="scheduledAt" type="datetime-local" required disabled={!sendingReady} /></label>
            <label className="marketing-audience-confirm"><input name="confirmAudience" type="checkbox" value="true" required disabled={!sendingReady} />Confirm {audienceSize} subscribed recipient{audienceSize === 1 ? "" : "s"}</label>
            <ActionButton label="Schedule" disabled={!sendingReady || audienceSize < 1} />
            <MarketingActionFeedback state={scheduleState} />
          </form>
        </>
      ) : null}
      <form action={cancelAction}>
        <input name="campaignId" type="hidden" value={campaignId} />
        <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
        <input name="intent" type="hidden" value="cancel" />
        <ActionButton label="Cancel" danger />
        <MarketingActionFeedback state={cancelState} />
      </form>
    </div>
  );
}
