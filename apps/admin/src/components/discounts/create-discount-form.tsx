"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createDiscountAction,
  type DiscountActionState
} from "@/app/(admin)/discounts/actions";
import { DiscountActionFeedback } from "@/components/discounts/discount-action-feedback";

const INITIAL_STATE: DiscountActionState = {};

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button className="staff-button staff-button-primary" type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create discount"}
    </button>
  );
}

export function CreateDiscountForm() {
  const [state, action] = useActionState(createDiscountAction, INITIAL_STATE);
  const [kind, setKind] = useState<"percentage" | "fixed_eur">("percentage");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setKind("percentage");
    }
  }, [state]);

  return (
    <form ref={formRef} className="discount-create-form" action={action}>
      <div className="discount-form-grid discount-form-grid-primary">
        <div className="staff-field">
          <label htmlFor="discount-name">Internal name</label>
          <input
            id="discount-name"
            name="name"
            type="text"
            minLength={2}
            maxLength={120}
            placeholder="Summer launch"
            required
          />
        </div>
        <div className="staff-field">
          <label htmlFor="discount-code">Customer code</label>
          <input
            id="discount-code"
            name="code"
            type="text"
            minLength={3}
            maxLength={40}
            pattern="[A-Za-z0-9_-]{3,40}"
            placeholder="SUMMER20"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </div>
        <div className="staff-field">
          <label htmlFor="discount-kind">Discount type</label>
          <select
            id="discount-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as "percentage" | "fixed_eur")}
          >
            <option value="percentage">Percentage</option>
            <option value="fixed_eur">Fixed EUR amount</option>
          </select>
        </div>
        <div className="staff-field">
          <label htmlFor="discount-value">
            {kind === "percentage" ? "Percentage" : "Amount in EUR"}
          </label>
          <div className="discount-value-input">
            <span aria-hidden="true">{kind === "percentage" ? "%" : "€"}</span>
            <input
              id="discount-value"
              name="discountValue"
              type="number"
              min="0.01"
              max={kind === "percentage" ? "100" : "1000000"}
              step="0.01"
              inputMode="decimal"
              placeholder={kind === "percentage" ? "20" : "10.00"}
              required
            />
          </div>
        </div>
      </div>

      <fieldset className="discount-fieldset">
        <legend>Schedule and usage limits</legend>
        <p>Leave a field blank for no limit. Date and time values use UTC.</p>
        <div className="discount-form-grid">
          <div className="staff-field">
            <label htmlFor="discount-start">Starts at (UTC)</label>
            <input id="discount-start" name="startsAt" type="datetime-local" />
          </div>
          <div className="staff-field">
            <label htmlFor="discount-end">Ends at (UTC)</label>
            <input id="discount-end" name="endsAt" type="datetime-local" />
          </div>
          <div className="staff-field">
            <label htmlFor="discount-total-limit">Total redemptions</label>
            <input
              id="discount-total-limit"
              name="maxRedemptions"
              type="number"
              min="1"
              max="10000000"
              step="1"
              inputMode="numeric"
              placeholder="Unlimited"
            />
          </div>
          <div className="staff-field">
            <label htmlFor="discount-customer-limit">Per customer</label>
            <input
              id="discount-customer-limit"
              name="maxRedemptionsPerCustomer"
              type="number"
              min="1"
              max="10000000"
              step="1"
              inputMode="numeric"
              placeholder="Unlimited"
            />
          </div>
          <div className="staff-field">
            <label htmlFor="discount-minimum">Minimum order subtotal (EUR)</label>
            <input
              id="discount-minimum"
              name="minimumSubtotal"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              inputMode="decimal"
              placeholder="No minimum"
            />
          </div>
          <label className="discount-checkbox" htmlFor="discount-first-order">
            <input id="discount-first-order" name="firstOrderOnly" type="checkbox" />
            <span>
              <strong>First order only</strong>
              <small>Only new customers will be eligible.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="discount-form-footer">
        <CreateButton />
        <small>New codes are enabled immediately unless their start date is in the future.</small>
      </div>
      <DiscountActionFeedback state={state} />
    </form>
  );
}
