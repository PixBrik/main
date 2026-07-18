"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { requireTrustedMutation } from "@/lib/auth/request-security";
import { withDatabaseRequestContext } from "@/lib/db";

export type InventoryActionState = Readonly<{
  status?: "success" | "error";
  message?: string;
}>;

const LOCATION_KINDS = new Set(["supplier", "warehouse", "fulfilment", "transit"]);
const MOVEMENT_KINDS = new Set(["receipt", "adjustment", "damage", "return"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(
  formData: FormData,
  key: string,
  label: string,
  minimum: number,
  maximum: number
): string {
  const value = formString(formData, key);
  if (value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} characters.`);
  }
  return value;
}

function optionalDecimal(formData: FormData, key: string, label: string): string | null {
  const value = formString(formData, key).replace(",", ".");
  if (!value) return null;
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(value)) {
    throw new Error(`${label} must be a positive number with up to three decimal places.`);
  }
  return value;
}

function optionalEuroMinor(formData: FormData, key: string): string | null {
  const value = formString(formData, key).replace(",", ".");
  if (!value) return null;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Unit cost must be a positive EUR amount with up to two decimals.");
  }
  const [euros, decimals = ""] = value.split(".");
  return (BigInt(euros) * 100n + BigInt(decimals.padEnd(2, "0"))).toString();
}

function integerDelta(formData: FormData, key: string, label: string): number {
  const value = formString(formData, key);
  if (!/^-?\d{1,7}$/.test(value)) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 1_000_000) {
    throw new Error(`${label} must be between -1,000,000 and 1,000,000.`);
  }
  return parsed;
}

function mutationError(error: unknown, fallback: string): InventoryActionState {
  const code = error instanceof Error && "code" in error
    ? String((error as Error & { code?: unknown }).code ?? "")
    : "";
  if (code === "23505") {
    return { status: "error", message: "That code or catalog identity already exists." };
  }
  if (code === "23503") {
    return { status: "error", message: "The selected inventory record no longer exists. Refresh and retry." };
  }
  if (code === "23514" || code === "P0001") {
    return {
      status: "error",
      message: "The adjustment would create an impossible balance. Check on-hand and damaged quantities."
    };
  }
  if (error instanceof Error && !code) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: fallback };
}

function refreshInventory(): void {
  try {
    revalidatePath("/inventory");
  } catch {
    // The committed mutation remains valid if route revalidation is unavailable.
  }
}

export async function createInventoryLocationAction(
  _previousState: InventoryActionState,
  formData: FormData
): Promise<InventoryActionState> {
  const principal = await requirePermission("inventory.manage");

  try {
    const request = await requireTrustedMutation();
    const code = requiredText(formData, "code", "Location code", 2, 40).toLowerCase();
    const name = requiredText(formData, "name", "Location name", 2, 120);
    const locationKind = formString(formData, "locationKind");
    const countryCode = formString(formData, "countryCode").toUpperCase();
    if (!/^[a-z0-9_-]+$/.test(code)) {
      throw new Error("Location code can use lowercase letters, numbers, underscores and hyphens.");
    }
    if (!LOCATION_KINDS.has(locationKind)) throw new Error("Choose a valid location type.");
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("Country must be a two-letter ISO code.");

    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [created] = await sql<{ id: string }[]>`
        INSERT INTO pixbrik.inventory_location (code, name, location_kind, country_code)
        VALUES (${code}, ${name}, ${locationKind}, ${countryCode})
        RETURNING id::text
      `;
      await sql`
        INSERT INTO pixbrik.audit_event (
          actor_user_id, actor_subject, action, target_type, target_id,
          request_id, ip_hash, user_agent, after_state, metadata
        ) VALUES (
          ${principal.userId}::uuid, ${principal.subject}, 'inventory.location_created',
          'inventory_location', ${created.id}, ${request.requestId}, ${request.ipDigest},
          ${request.userAgentDigest},
          jsonb_build_object('code', ${code}, 'name', ${name}, 'location_kind', ${locationKind}, 'country_code', ${countryCode}),
          jsonb_build_object('source', 'backoffice')
        )
      `;
    });
  } catch (error) {
    return mutationError(error, "The inventory location could not be created.");
  }

  refreshInventory();
  return { status: "success", message: "Inventory location created." };
}

export async function createInventoryItemAction(
  _previousState: InventoryActionState,
  formData: FormData
): Promise<InventoryActionState> {
  const principal = await requirePermission("inventory.manage");

  try {
    const request = await requireTrustedMutation();
    const sku = requiredText(formData, "sku", "SKU", 2, 80).toUpperCase();
    const catalogRelease = requiredText(formData, "catalogRelease", "Catalog release", 1, 80);
    const partKey = requiredText(formData, "partKey", "Part key", 1, 120);
    const colorKey = requiredText(formData, "colorKey", "Colour key", 1, 120);
    const displayName = requiredText(formData, "displayName", "Display name", 2, 160);
    const weightGrams = optionalDecimal(formData, "weightGrams", "Weight");
    const unitCostEurMinor = optionalEuroMinor(formData, "unitCostEur");
    if (!/^[A-Z0-9._-]{2,80}$/.test(sku)) {
      throw new Error("SKU can use uppercase letters, numbers, dots, underscores and hyphens.");
    }

    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const [created] = await sql<{ id: string }[]>`
        INSERT INTO pixbrik.inventory_catalog_item (
          sku, catalog_release, part_key, color_key, localized_name,
          weight_grams, unit_cost_eur_minor
        ) VALUES (
          ${sku}, ${catalogRelease}, ${partKey}, ${colorKey},
          jsonb_build_object('en', ${displayName}),
          ${weightGrams}::numeric, ${unitCostEurMinor}::bigint
        )
        RETURNING id::text
      `;
      await sql`
        INSERT INTO pixbrik.audit_event (
          actor_user_id, actor_subject, action, target_type, target_id,
          request_id, ip_hash, user_agent, after_state, metadata
        ) VALUES (
          ${principal.userId}::uuid, ${principal.subject}, 'inventory.item_created',
          'inventory_catalog_item', ${created.id}, ${request.requestId}, ${request.ipDigest},
          ${request.userAgentDigest},
          jsonb_build_object(
            'sku', ${sku}, 'catalog_release', ${catalogRelease}, 'part_key', ${partKey},
            'color_key', ${colorKey}, 'display_name', ${displayName}
          ),
          jsonb_build_object('source', 'backoffice')
        )
      `;
    });
  } catch (error) {
    return mutationError(error, "The catalog item could not be created.");
  }

  refreshInventory();
  return { status: "success", message: "Catalog item created and ready for stock receipts." };
}

export async function adjustInventoryStockAction(
  _previousState: InventoryActionState,
  formData: FormData
): Promise<InventoryActionState> {
  const principal = await requirePermission("inventory.manage");

  try {
    const request = await requireTrustedMutation();
    const locationId = formString(formData, "locationId");
    const itemId = formString(formData, "itemId");
    const idempotencyKey = formString(formData, "idempotencyKey");
    const movementKind = formString(formData, "movementKind");
    const onHandDelta = integerDelta(formData, "onHandDelta", "On-hand change");
    const damagedDelta = integerDelta(formData, "damagedDelta", "Damaged change");
    const reason = requiredText(formData, "reason", "Reason", 5, 500);
    if (!UUID_PATTERN.test(locationId) || !UUID_PATTERN.test(itemId)) {
      throw new Error("Choose a valid inventory item and location.");
    }
    if (!UUID_PATTERN.test(idempotencyKey)) {
      throw new Error("This stock form has expired. Refresh the page and try again.");
    }
    if (!MOVEMENT_KINDS.has(movementKind)) throw new Error("Choose a valid movement type.");
    if (onHandDelta === 0 && damagedDelta === 0) {
      throw new Error("Enter at least one non-zero stock change.");
    }
    if (movementKind === "receipt" && (onHandDelta <= 0 || damagedDelta !== 0)) {
      throw new Error("A receipt must add a positive on-hand quantity and cannot mark damage.");
    }
    if (movementKind === "damage" && damagedDelta === 0) {
      throw new Error("A damage movement must change the damaged quantity.");
    }

    let replayed = false;
    await withDatabaseRequestContext("admin", { userId: principal.userId }, async (sql) => {
      const ledgerKey = `manual-admin:${idempotencyKey}`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${ledgerKey}, 0))`;
      const [existing] = await sql<{
        id: string;
        location_id: string;
        item_id: string;
        movement_kind: string;
        on_hand_delta: number;
        damaged_delta: number;
        reason: string | null;
        actor_user_id: string | null;
      }[]>`
        SELECT id::text, location_id::text, item_id::text, movement_kind::text,
          on_hand_delta, damaged_delta, reason, actor_user_id::text
        FROM pixbrik.inventory_movement
        WHERE idempotency_key = ${ledgerKey}
        LIMIT 1
      `;
      if (existing) {
        const sameMovement = existing.location_id === locationId
          && existing.item_id === itemId
          && existing.movement_kind === movementKind
          && existing.on_hand_delta === onHandDelta
          && existing.damaged_delta === damagedDelta
          && existing.reason === reason
          && existing.actor_user_id === principal.userId;
        if (!sameMovement) throw new Error("This stock form was already used. Refresh before recording another movement.");
        replayed = true;
        return;
      }

      const [movement] = await sql<{ id: string }[]>`
        INSERT INTO pixbrik.inventory_movement (
          location_id, item_id, movement_kind, on_hand_delta, damaged_delta,
          reference_type, reference_id, reason, actor_user_id, idempotency_key
        ) VALUES (
          ${locationId}::uuid, ${itemId}::uuid, ${movementKind}::pixbrik.inventory_movement_kind,
          ${onHandDelta}, ${damagedDelta}, 'manual_admin', ${idempotencyKey}, ${reason},
          ${principal.userId}::uuid, ${ledgerKey}
        )
        RETURNING id::text
      `;
      const [balance] = await sql<{
        on_hand_quantity: number;
        reserved_quantity: number;
        damaged_quantity: number;
        available_quantity: number;
      }[]>`
        SELECT on_hand_quantity, reserved_quantity, damaged_quantity, available_quantity
        FROM pixbrik.inventory_balance
        WHERE location_id = ${locationId}::uuid AND item_id = ${itemId}::uuid
      `;
      if (!balance) throw new Error("The resulting inventory balance could not be read.");
      await sql`
        INSERT INTO pixbrik.audit_event (
          actor_user_id, actor_subject, action, target_type, target_id,
          request_id, ip_hash, user_agent, reason, after_state, metadata
        ) VALUES (
          ${principal.userId}::uuid, ${principal.subject}, 'inventory.stock_adjusted',
          'inventory_movement', ${movement.id}, ${request.requestId}, ${request.ipDigest},
          ${request.userAgentDigest}, ${reason},
          jsonb_build_object(
            'location_id', ${locationId}, 'item_id', ${itemId}, 'movement_kind', ${movementKind},
            'on_hand_delta', ${onHandDelta}, 'damaged_delta', ${damagedDelta},
            'resulting_balance', jsonb_build_object(
              'on_hand_quantity', ${balance.on_hand_quantity},
              'reserved_quantity', ${balance.reserved_quantity},
              'damaged_quantity', ${balance.damaged_quantity},
              'available_quantity', ${balance.available_quantity}
            )
          ),
          jsonb_build_object('source', 'backoffice', 'ledger', 'inventory_movement')
        )
      `;
    });
    if (replayed) {
      refreshInventory();
      return { status: "success", message: "This stock movement was already recorded; no duplicate was created." };
    }
  } catch (error) {
    return mutationError(error, "The stock adjustment could not be recorded.");
  }

  refreshInventory();
  return { status: "success", message: "Stock movement recorded in the immutable inventory ledger." };
}
