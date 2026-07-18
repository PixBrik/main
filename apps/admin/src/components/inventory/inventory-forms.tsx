"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  adjustInventoryStockAction,
  createInventoryItemAction,
  createInventoryLocationAction,
  type InventoryActionState
} from "@/app/(admin)/inventory/actions";
import type { InventoryItem, InventoryLocation } from "@/lib/inventory";

const INITIAL_STATE: InventoryActionState = {};

function SubmitButton({
  children,
  disabled = false
}: Readonly<{ children: React.ReactNode; disabled?: boolean }>) {
  const { pending } = useFormStatus();
  return (
    <button className="staff-button staff-button-primary" type="submit" disabled={disabled || pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}

function Feedback({ state }: Readonly<{ state: InventoryActionState }>) {
  if (!state.message) return null;
  return (
    <p
      className={`staff-message ${state.status === "error" ? "staff-message-error" : "staff-message-success"}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

export function CreateInventoryLocationForm() {
  const [state, action] = useActionState(createInventoryLocationAction, INITIAL_STATE);

  return (
    <form className="inventory-form" action={action}>
      <div className="inventory-form-grid">
        <label className="staff-field">
          <span>Location code</span>
          <input name="code" required minLength={2} maxLength={40} placeholder="paris_warehouse" />
        </label>
        <label className="staff-field">
          <span>Name</span>
          <input name="name" required minLength={2} maxLength={120} placeholder="Paris warehouse" />
        </label>
        <label className="staff-field">
          <span>Type</span>
          <select name="locationKind" defaultValue="warehouse" required>
            <option value="warehouse">Warehouse</option>
            <option value="fulfilment">Fulfilment centre</option>
            <option value="supplier">Supplier</option>
            <option value="transit">Transit</option>
          </select>
        </label>
        <label className="staff-field">
          <span>Country (ISO)</span>
          <input name="countryCode" required minLength={2} maxLength={2} placeholder="FR" />
        </label>
      </div>
      <SubmitButton>Create location</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function CreateInventoryItemForm() {
  const [state, action] = useActionState(createInventoryItemAction, INITIAL_STATE);

  return (
    <form className="inventory-form" action={action}>
      <div className="inventory-form-grid inventory-form-grid-3">
        <label className="staff-field">
          <span>SKU</span>
          <input name="sku" required minLength={2} maxLength={80} placeholder="BRICK.2X4.RED" />
        </label>
        <label className="staff-field">
          <span>Catalog release</span>
          <input name="catalogRelease" required maxLength={80} placeholder="2026-01" />
        </label>
        <label className="staff-field">
          <span>Display name</span>
          <input name="displayName" required minLength={2} maxLength={160} placeholder="2 × 4 brick · red" />
        </label>
        <label className="staff-field">
          <span>Part key</span>
          <input name="partKey" required maxLength={120} placeholder="brick_2x4" />
        </label>
        <label className="staff-field">
          <span>Colour key</span>
          <input name="colorKey" required maxLength={120} placeholder="red" />
        </label>
        <label className="staff-field">
          <span>Weight (g, optional)</span>
          <input name="weightGrams" inputMode="decimal" placeholder="2.32" />
        </label>
        <label className="staff-field">
          <span>Unit cost EUR (optional)</span>
          <input name="unitCostEur" inputMode="decimal" placeholder="0.12" />
        </label>
      </div>
      <SubmitButton>Add catalog item</SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function AdjustInventoryStockForm({
  locations,
  items,
  idempotencyKey
}: Readonly<{
  locations: readonly InventoryLocation[];
  items: readonly InventoryItem[];
  idempotencyKey: string;
}>) {
  const [state, action] = useActionState(adjustInventoryStockAction, INITIAL_STATE);
  const disabled = locations.length === 0 || items.length === 0;

  return (
    <form className="inventory-form" action={action}>
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      <div className="inventory-form-grid inventory-form-grid-3">
        <label className="staff-field">
          <span>Location</span>
          <select name="locationId" required disabled={disabled} defaultValue="">
            <option value="" disabled>Select a location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </select>
        </label>
        <label className="staff-field">
          <span>Catalog item</span>
          <select name="itemId" required disabled={disabled} defaultValue="">
            <option value="" disabled>Select an item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} · {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="staff-field">
          <span>Movement type</span>
          <select name="movementKind" defaultValue="receipt" required disabled={disabled}>
            <option value="receipt">Receipt</option>
            <option value="adjustment">Count correction</option>
            <option value="damage">Damage correction</option>
            <option value="return">Customer return</option>
          </select>
        </label>
        <label className="staff-field">
          <span>On-hand change</span>
          <input name="onHandDelta" type="number" step="1" defaultValue="0" required disabled={disabled} />
        </label>
        <label className="staff-field">
          <span>Damaged change</span>
          <input name="damagedDelta" type="number" step="1" defaultValue="0" required disabled={disabled} />
        </label>
        <label className="staff-field inventory-reason-field">
          <span>Reason</span>
          <input
            name="reason"
            required
            minLength={5}
            maxLength={500}
            disabled={disabled}
            placeholder="Supplier delivery PO-2041"
          />
        </label>
      </div>
      <p className="inventory-form-note">
        Quantities are deltas, not new totals. Use a negative number to correct stock down. Every
        submission creates an immutable movement and audit record.
      </p>
      <SubmitButton disabled={disabled}>
        {disabled ? "Create a location and item first" : "Record stock movement"}
      </SubmitButton>
      <Feedback state={state} />
    </form>
  );
}
