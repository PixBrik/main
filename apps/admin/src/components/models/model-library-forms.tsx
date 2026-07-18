"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  attachModelVersionAction,
  createModelCategoryAction,
  createModelItemAction,
  setModelCategoryEnabledAction,
  updateModelItemStatusAction,
  updateModelVersionStatusAction,
  type ModelLibraryActionState
} from "@/app/(admin)/models/actions";
import type { ModelLibraryStatus } from "@/lib/model-library";
import styles from "@/components/models/model-library.module.css";

const INITIAL_STATE: ModelLibraryActionState = {};
const TRANSLATIONS = [
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "ar", label: "Arabic" }
] as const;

type CategoryOption = Readonly<{ id: string; name: string; enabled: boolean }>;
type ItemOption = Readonly<{ id: string; title: string; status: ModelLibraryStatus }>;
type BuildOption = Readonly<{
  id: string;
  title: string;
  versionNumber: number;
  brickCount?: number;
  provider?: string;
}>;

function Feedback({ state }: Readonly<{ state: ModelLibraryActionState }>) {
  if (!state.message) return null;
  return (
    <p
      className={`${styles.feedback} ${state.status === "error" ? styles.feedbackError : styles.feedbackSuccess}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function SubmitButton({ label, pendingLabel = "Saving…", compact = false, ariaLabel }: Readonly<{
  label: string;
  pendingLabel?: string;
  compact?: boolean;
  ariaLabel?: string;
}>) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`${styles.button} ${compact ? styles.buttonCompact : ""}`}
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function TranslationFields({ prefix, label, multiline = false }: Readonly<{
  prefix: string;
  label: string;
  multiline?: boolean;
}>) {
  return (
    <details className={styles.translations}>
      <summary>Add translations</summary>
      <div className={styles.formGrid}>
        {TRANSLATIONS.map((translation) => (
          <label className={styles.field} key={translation.code}>
            <span>{label} · {translation.label}</span>
            {multiline ? (
              <textarea name={`${prefix}_${translation.code}`} rows={2} dir={translation.code === "ar" ? "rtl" : "ltr"} />
            ) : (
              <input name={`${prefix}_${translation.code}`} type="text" dir={translation.code === "ar" ? "rtl" : "ltr"} />
            )}
          </label>
        ))}
      </div>
    </details>
  );
}

export function CreateModelCategoryForm({ categories }: Readonly<{ categories: readonly CategoryOption[] }>) {
  const [state, action] = useActionState(createModelCategoryAction, INITIAL_STATE);
  return (
    <form className={styles.form} action={action}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>English name</span>
          <input name="name_en" type="text" maxLength={120} required />
        </label>
        <label className={styles.field}>
          <span>Slug</span>
          <input name="slug" type="text" minLength={2} maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="vehicles" required />
        </label>
        <label className={styles.field}>
          <span>Parent category</span>
          <select name="parentId" defaultValue="">
            <option value="">None</option>
            {categories.filter((category) => category.enabled).map((category) => (
              <option value={category.id} key={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Sort order</span>
          <input name="sortOrder" type="number" min={0} max={100000} step={1} defaultValue={100} required />
        </label>
      </div>
      <TranslationFields prefix="name" label="Category name" />
      <SubmitButton label="Create category" pendingLabel="Creating…" />
      <Feedback state={state} />
    </form>
  );
}

export function CreateModelItemForm({ categories }: Readonly<{ categories: readonly CategoryOption[] }>) {
  const [state, action] = useActionState(createModelItemAction, INITIAL_STATE);
  return (
    <form className={styles.form} action={action}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>English title</span>
          <input name="title_en" type="text" maxLength={160} required />
        </label>
        <label className={styles.field}>
          <span>Slug</span>
          <input name="slug" type="text" minLength={2} maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="classic-sports-car" required />
        </label>
        <label className={styles.field}>
          <span>Category</span>
          <select name="categoryId" defaultValue="">
            <option value="">Uncategorized</option>
            {categories.filter((category) => category.enabled).map((category) => (
              <option value={category.id} key={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>English description</span>
          <textarea name="description_en" rows={3} maxLength={2000} />
        </label>
      </div>
      <TranslationFields prefix="title" label="Title" />
      <TranslationFields prefix="description" label="Description" multiline />
      <SubmitButton label="Create draft model" pendingLabel="Creating…" />
      <Feedback state={state} />
    </form>
  );
}

export function AttachModelVersionForm({ items, builds }: Readonly<{
  items: readonly ItemOption[];
  builds: readonly BuildOption[];
}>) {
  const [state, action] = useActionState(attachModelVersionAction, INITIAL_STATE);
  return (
    <form className={styles.form} action={action}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Library model</span>
          <select name="itemId" defaultValue="" required>
            <option value="" disabled>Select a model</option>
            {items.filter((item) => item.status !== "retired").map((item) => (
              <option value={item.id} key={item.id}>{item.title} · {item.status}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Approved build version</span>
          <select name="buildVersionId" defaultValue="" required>
            <option value="" disabled>Select an approved build</option>
            {builds.map((build) => (
              <option value={build.id} key={build.id}>
                {build.title} · v{build.versionNumber}{build.brickCount === undefined ? "" : ` · ${build.brickCount.toLocaleString("en-GB")} bricks`}{build.provider ? ` · ${build.provider}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.hint}>
        Only locked, approved outputs from the build-review workflow appear here. Attaching creates a draft library version; it does not publish it.
      </p>
      <SubmitButton label="Attach as new version" pendingLabel="Attaching…" />
      <Feedback state={state} />
    </form>
  );
}

export function ModelItemStatusForm({ itemId, itemTitle, nextStatuses }: Readonly<{
  itemId: string;
  itemTitle: string;
  nextStatuses: readonly ModelLibraryStatus[];
}>) {
  const [state, action] = useActionState(updateModelItemStatusAction, INITIAL_STATE);
  if (nextStatuses.length === 0) return null;
  return (
    <form className={styles.statusForm} action={action}>
      <input name="itemId" type="hidden" value={itemId} />
      <label>
        <span className={styles.srOnly}>Next model status</span>
        <select name="status" defaultValue={nextStatuses[0]}>
          {nextStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
        </select>
      </label>
      <SubmitButton label="Apply" ariaLabel={`Apply status change to ${itemTitle}`} compact />
      <Feedback state={state} />
    </form>
  );
}

export function ModelVersionStatusForm({ versionId, versionLabel, nextStatuses }: Readonly<{
  versionId: string;
  versionLabel: string;
  nextStatuses: readonly ModelLibraryStatus[];
}>) {
  const [state, action] = useActionState(updateModelVersionStatusAction, INITIAL_STATE);
  if (nextStatuses.length === 0) return null;
  return (
    <form className={styles.statusForm} action={action}>
      <input name="versionId" type="hidden" value={versionId} />
      <label>
        <span className={styles.srOnly}>Next library version status</span>
        <select name="status" defaultValue={nextStatuses[0]}>
          {nextStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
        </select>
      </label>
      <SubmitButton label="Apply" ariaLabel={`Apply status change to ${versionLabel}`} compact />
      <Feedback state={state} />
    </form>
  );
}

export function CategoryVisibilityForm({ categoryId, categoryName, enabled }: Readonly<{
  categoryId: string;
  categoryName: string;
  enabled: boolean;
}>) {
  const [state, action] = useActionState(setModelCategoryEnabledAction, INITIAL_STATE);
  return (
    <form className={styles.statusForm} action={action}>
      <input name="categoryId" type="hidden" value={categoryId} />
      <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
      <SubmitButton
        label={enabled ? "Disable" : "Enable"}
        ariaLabel={`${enabled ? "Disable" : "Enable"} category ${categoryName}`}
        compact
      />
      <Feedback state={state} />
    </form>
  );
}
