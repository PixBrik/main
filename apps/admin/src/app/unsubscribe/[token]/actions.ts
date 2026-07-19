"use server";

import { redirect } from "next/navigation";

import { unsubscribeMarketing } from "@/lib/email/unsubscribe";

export async function confirmUnsubscribeAction(token: string): Promise<void> {
  let result: "done" | "invalid" | "failed";
  try {
    result = (await unsubscribeMarketing(token, "pixbrik.preference_page")) ? "done" : "invalid";
  } catch {
    result = "failed";
  }
  redirect(`/unsubscribe/${encodeURIComponent(token)}?result=${result}`);
}
