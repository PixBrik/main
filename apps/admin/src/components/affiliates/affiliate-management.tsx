"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createAffiliateCodeAction,
  createAffiliatePartnerAction,
  setAffiliateCodeActiveAction,
  setAffiliatePartnerActiveAction,
  type AffiliateActionState
} from "@/app/(admin)/affiliates/actions";
import type { AffiliatePartnerStatus } from "@/lib/affiliates";

import styles from "./affiliate-management.module.css";

const INITIAL_STATE: AffiliateActionState = {};

export type AffiliatePartnerOption = Readonly<{
  id: string;
  publicName: string;
  status: AffiliatePartnerStatus;
}>;

export type AffiliatePartnerActionTarget = AffiliatePartnerOption & Readonly<{
  versionToken: string;
}>;

export type AffiliateCodeActionTarget = Readonly<{
  id: string;
  code: string;
  active: boolean;
  versionToken: string;
}>;

function Feedback({ state }: Readonly<{ state: AffiliateActionState }>) {
  if (!state.message) return null;
  return (
    <p
      className={`${styles.feedback} ${state.status === "error" ? styles.error : styles.success}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  kind = "primary",
  disabled = false,
  ariaLabel
}: Readonly<{
  label: string;
  pendingLabel: string;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  ariaLabel?: string;
}>) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`${styles.button} ${styles[kind]}`}
      type="submit"
      disabled={disabled || pending}
      aria-label={ariaLabel}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function CreatePartnerForm({ currencies }: Readonly<{ currencies: readonly string[] }>) {
  const [state, action] = useActionState(createAffiliatePartnerAction, INITIAL_STATE);
  return (
    <form className={styles.form} action={action}>
      <div className={styles.formHeading}>
        <div>
          <span className="eyebrow">New relationship</span>
          <h3>Add a partner</h3>
        </div>
        <span className={styles.step}>1</span>
      </div>
      <p className={styles.help}>Partners start as applicants. Activate them after checking the agreed terms.</p>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>Public partner name</span>
          <input name="publicName" type="text" minLength={2} maxLength={120} autoComplete="organization" required />
        </label>
        <label className={styles.field}>
          <span>Contact email</span>
          <input name="contactEmail" type="email" maxLength={254} autoComplete="email" required />
        </label>
        <label className={styles.field}>
          <span>Default commission</span>
          <span className={styles.inputSuffix}>
            <input name="commissionPercent" type="number" min="0" max="100" step="0.01" inputMode="decimal" defaultValue="10" required />
            <span>%</span>
          </span>
        </label>
        <label className={styles.field}>
          <span>Payout currency</span>
          <select name="payoutCurrency" defaultValue={currencies.includes("EUR") ? "EUR" : currencies[0]} required>
            {currencies.map((currency) => <option value={currency} key={currency}>{currency}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fullField}`}>
          <span>Terms version</span>
          <input name="termsVersion" type="text" maxLength={100} defaultValue="affiliate-v1" spellCheck={false} required />
          <small>Record the exact version agreed with this partner.</small>
        </label>
      </div>
      <SubmitButton label="Add applicant" pendingLabel="Adding…" disabled={currencies.length === 0} />
      {currencies.length === 0 ? <p className={styles.warning}>Enable a payout currency before adding a partner.</p> : null}
      <Feedback state={state} />
    </form>
  );
}

function CreateCodeForm({ partners }: Readonly<{ partners: readonly AffiliatePartnerOption[] }>) {
  const [state, action] = useActionState(createAffiliateCodeAction, INITIAL_STATE);
  const activePartners = partners.filter((partner) => partner.status === "active");
  return (
    <form className={styles.form} action={action}>
      <div className={styles.formHeading}>
        <div>
          <span className="eyebrow">Tracking link</span>
          <h3>Create a code</h3>
        </div>
        <span className={styles.step}>2</span>
      </div>
      <p className={styles.help}>A new code is enabled immediately and can only belong to an active partner.</p>
      <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.fullField}`}>
          <span>Partner</span>
          <select name="partnerId" defaultValue="" required disabled={activePartners.length === 0}>
            <option value="" disabled>Select an active partner</option>
            {activePartners.map((partner) => (
              <option value={partner.id} key={partner.id}>{partner.publicName}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Affiliate code</span>
          <input name="code" type="text" minLength={3} maxLength={40} pattern="[A-Za-z0-9_-]{3,40}" placeholder="CREATOR10" autoCapitalize="characters" spellCheck={false} required />
        </label>
        <label className={styles.field}>
          <span>Commission override</span>
          <span className={styles.inputSuffix}>
            <input name="commissionPercent" type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="Inherit" />
            <span>%</span>
          </span>
        </label>
        <label className={`${styles.field} ${styles.fullField}`}>
          <span>Destination path</span>
          <input name="destinationPath" type="text" maxLength={500} defaultValue="/" spellCheck={false} required />
          <small>Use a PixBrik path such as / or /shop — never an external URL.</small>
        </label>
      </div>
      <SubmitButton label="Create enabled code" pendingLabel="Creating…" disabled={activePartners.length === 0} />
      {activePartners.length === 0 ? <p className={styles.warning}>Activate a partner before creating a code.</p> : null}
      <Feedback state={state} />
    </form>
  );
}

export function PartnerStatusAction({ partner }: Readonly<{ partner: AffiliatePartnerActionTarget }>) {
  const [state, action] = useActionState(setAffiliatePartnerActiveAction, INITIAL_STATE);
  if (partner.status === "closed") return <span className={styles.muted}>Closed permanently</span>;

  const activate = partner.status !== "active";
  return (
    <div className={styles.rowAction}>
      <form
        action={action}
        onSubmit={(event) => {
          if (!activate && !window.confirm(`Suspend ${partner.publicName} and disable all of its active codes?`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="partnerId" value={partner.id} />
        <input type="hidden" name="versionToken" value={partner.versionToken} />
        <input type="hidden" name="active" value={String(activate)} />
        <SubmitButton
          label={activate ? "Activate" : "Suspend"}
          pendingLabel={activate ? "Activating…" : "Suspending…"}
          kind={activate ? "secondary" : "danger"}
          ariaLabel={`${activate ? "Activate" : "Suspend"} affiliate ${partner.publicName}`}
        />
      </form>
      <Feedback state={state} />
    </div>
  );
}

export function CodeStatusAction({ code }: Readonly<{ code: AffiliateCodeActionTarget }>) {
  const [state, action] = useActionState(setAffiliateCodeActiveAction, INITIAL_STATE);
  const activate = !code.active;
  return (
    <div className={styles.rowAction}>
      <form action={action}>
        <input type="hidden" name="codeId" value={code.id} />
        <input type="hidden" name="versionToken" value={code.versionToken} />
        <input type="hidden" name="active" value={String(activate)} />
        <SubmitButton
          label={activate ? "Enable" : "Disable"}
          pendingLabel={activate ? "Enabling…" : "Disabling…"}
          kind={activate ? "secondary" : "danger"}
          ariaLabel={`${activate ? "Enable" : "Disable"} affiliate code ${code.code}`}
        />
      </form>
      <Feedback state={state} />
    </div>
  );
}

export function AffiliateCreateForms({
  currencies,
  partners
}: Readonly<{
  currencies: readonly string[];
  partners: readonly AffiliatePartnerOption[];
}>) {
  return (
    <section className={styles.forms} aria-label="Create affiliate records">
      <CreatePartnerForm currencies={currencies} />
      <CreateCodeForm partners={partners} />
    </section>
  );
}
