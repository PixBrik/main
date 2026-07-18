"use client";

import { useState } from "react";

type TemporaryPasswordRevealProps = Readonly<{
  password: string;
  expiresAt?: string;
}>;

function stableUtcLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function TemporaryPasswordReveal({ password, expiresAt }: TemporaryPasswordRevealProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const expiryLabel = stableUtcLabel(expiresAt);

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="staff-secret" aria-labelledby="temporary-password-title">
      <div>
        <strong id="temporary-password-title">Copy this temporary password now</strong>
        <p>It is displayed only in this result and is never recoverable from PixBrik.</p>
      </div>
      <code>{password}</code>
      <button className="staff-button staff-button-dark" type="button" onClick={copyPassword}>
        Copy password
      </button>
      <p className="staff-secret-meta">
        {expiryLabel ? `Expires ${expiryLabel}. ` : ""}The user must replace it at first sign-in.
      </p>
      <span className="staff-sr-only" aria-live="polite">
        {copyStatus === "copied"
          ? "Temporary password copied."
          : copyStatus === "failed"
            ? "Copy failed. Select the password and copy it manually."
            : ""}
      </span>
    </section>
  );
}
