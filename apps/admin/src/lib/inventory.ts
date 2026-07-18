import "server-only";

import { withDatabaseRequestContext } from "@/lib/db";

export type InventoryLocation = Readonly<{
  id: string;
  code: string;
  name: string;
  locationKind: "supplier" | "warehouse" | "fulfilment" | "transit";
  countryCode: string;
  enabled: boolean;
}>;

export type InventoryItem = Readonly<{
  id: string;
  sku: string;
  catalogRelease: string;
  partKey: string;
  colorKey: string;
  displayName: string;
  weightGrams: string | null;
  unitCostEurMinor: string | null;
  active: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  damagedQuantity: number;
  availableQuantity: number;
  locationCount: number;
}>;

export type InventoryBalance = Readonly<{
  locationId: string;
  locationCode: string;
  locationName: string;
  itemId: string;
  sku: string;
  displayName: string;
  onHandQuantity: number;
  reservedQuantity: number;
  damagedQuantity: number;
  availableQuantity: number;
  updatedAt: string;
}>;

export type InventoryMovement = Readonly<{
  id: string;
  locationCode: string;
  sku: string;
  movementKind: string;
  onHandDelta: number;
  reservedDelta: number;
  damagedDelta: number;
  reason: string | null;
  actorName: string | null;
  occurredAt: string;
}>;

export type InventoryOverview = Readonly<{
  summary: Readonly<{
    itemCount: number;
    onHandQuantity: number;
    availableQuantity: number;
    lowStockCount: number;
  }>;
  locations: InventoryLocation[];
  items: InventoryItem[];
  balances: InventoryBalance[];
  movements: InventoryMovement[];
}>;

type LocationRow = {
  id: string;
  code: string;
  name: string;
  location_kind: InventoryLocation["locationKind"];
  country_code: string;
  enabled: boolean;
};

type ItemRow = {
  id: string;
  sku: string;
  catalog_release: string;
  part_key: string;
  color_key: string;
  display_name: string;
  weight_grams: string | null;
  unit_cost_eur_minor: string | null;
  active: boolean;
  on_hand_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  available_quantity: number;
  location_count: number;
};

type BalanceRow = {
  location_id: string;
  location_code: string;
  location_name: string;
  item_id: string;
  sku: string;
  display_name: string;
  on_hand_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  available_quantity: number;
  updated_at: Date;
};

type MovementRow = {
  id: string;
  location_code: string;
  sku: string;
  movement_kind: string;
  on_hand_delta: number;
  reserved_delta: number;
  damaged_delta: number;
  reason: string | null;
  actor_name: string | null;
  occurred_at: Date;
};

type SummaryRow = {
  item_count: number;
  on_hand_quantity: number;
  available_quantity: number;
  low_stock_count: number;
};

function normalizeSearch(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 100);
}

/** Fresh, request-scoped inventory data. Admin screens must never show cached stock. */
export async function listInventory(
  userId: string,
  searchValue?: string
): Promise<InventoryOverview> {
  const search = normalizeSearch(searchValue);
  const pattern = `%${search}%`;

  return withDatabaseRequestContext("admin", { userId }, async (sql) => {
    const [locations, items, summaryRows, balances, movements] = await Promise.all([
      sql<LocationRow[]>`
        SELECT id::text, code, name, location_kind, country_code, enabled
        FROM pixbrik.inventory_location
        ORDER BY enabled DESC, name ASC
      `,
      sql<ItemRow[]>`
        SELECT
          item.id::text,
          item.sku,
          item.catalog_release,
          item.part_key,
          item.color_key,
          COALESCE(item.localized_name ->> 'en', item.part_key) AS display_name,
          item.weight_grams::text,
          item.unit_cost_eur_minor::text,
          item.active,
          COALESCE(sum(balance.on_hand_quantity), 0)::integer AS on_hand_quantity,
          COALESCE(sum(balance.reserved_quantity), 0)::integer AS reserved_quantity,
          COALESCE(sum(balance.damaged_quantity), 0)::integer AS damaged_quantity,
          COALESCE(sum(balance.available_quantity), 0)::integer AS available_quantity,
          count(balance.location_id)::integer AS location_count
        FROM pixbrik.inventory_catalog_item item
        LEFT JOIN pixbrik.inventory_balance balance ON balance.item_id = item.id
        WHERE ${search} = ''
          OR item.sku ILIKE ${pattern}
          OR item.part_key ILIKE ${pattern}
          OR item.color_key ILIKE ${pattern}
          OR item.localized_name::text ILIKE ${pattern}
          OR EXISTS (
            SELECT 1
            FROM pixbrik.inventory_balance search_balance
            JOIN pixbrik.inventory_location search_location
              ON search_location.id = search_balance.location_id
            WHERE search_balance.item_id = item.id
              AND (search_location.name ILIKE ${pattern} OR search_location.code ILIKE ${pattern})
          )
        GROUP BY item.id
        ORDER BY item.active DESC, item.sku ASC
        LIMIT 250
      `,
      sql<SummaryRow[]>`
        SELECT
          count(*)::integer AS item_count,
          COALESCE(sum(item_totals.on_hand_quantity), 0)::integer AS on_hand_quantity,
          COALESCE(sum(item_totals.available_quantity), 0)::integer AS available_quantity,
          count(*) FILTER (WHERE item_totals.available_quantity <= 0)::integer AS low_stock_count
        FROM (
          SELECT
            item.id,
            COALESCE(sum(balance.on_hand_quantity), 0)::integer AS on_hand_quantity,
            COALESCE(sum(balance.available_quantity), 0)::integer AS available_quantity
          FROM pixbrik.inventory_catalog_item item
          LEFT JOIN pixbrik.inventory_balance balance ON balance.item_id = item.id
          WHERE ${search} = ''
            OR item.sku ILIKE ${pattern}
            OR item.part_key ILIKE ${pattern}
            OR item.color_key ILIKE ${pattern}
            OR item.localized_name::text ILIKE ${pattern}
            OR EXISTS (
              SELECT 1
              FROM pixbrik.inventory_balance search_balance
              JOIN pixbrik.inventory_location search_location
                ON search_location.id = search_balance.location_id
              WHERE search_balance.item_id = item.id
                AND (search_location.name ILIKE ${pattern} OR search_location.code ILIKE ${pattern})
            )
          GROUP BY item.id
        ) item_totals
      `,
      sql<BalanceRow[]>`
        SELECT
          location.id::text AS location_id,
          location.code AS location_code,
          location.name AS location_name,
          item.id::text AS item_id,
          item.sku,
          COALESCE(item.localized_name ->> 'en', item.part_key) AS display_name,
          balance.on_hand_quantity,
          balance.reserved_quantity,
          balance.damaged_quantity,
          balance.available_quantity,
          balance.updated_at
        FROM pixbrik.inventory_balance balance
        JOIN pixbrik.inventory_location location ON location.id = balance.location_id
        JOIN pixbrik.inventory_catalog_item item ON item.id = balance.item_id
        WHERE ${search} = ''
          OR item.sku ILIKE ${pattern}
          OR item.part_key ILIKE ${pattern}
          OR item.color_key ILIKE ${pattern}
          OR item.localized_name::text ILIKE ${pattern}
          OR location.name ILIKE ${pattern}
          OR location.code ILIKE ${pattern}
        ORDER BY item.sku ASC, location.name ASC
        LIMIT 500
      `,
      sql<MovementRow[]>`
        SELECT
          movement.id::text,
          location.code AS location_code,
          item.sku,
          movement.movement_kind::text,
          movement.on_hand_delta,
          movement.reserved_delta,
          movement.damaged_delta,
          movement.reason,
          actor.display_name AS actor_name,
          movement.occurred_at
        FROM pixbrik.inventory_movement movement
        JOIN pixbrik.inventory_location location ON location.id = movement.location_id
        JOIN pixbrik.inventory_catalog_item item ON item.id = movement.item_id
        LEFT JOIN pixbrik.app_user actor ON actor.id = movement.actor_user_id
        ORDER BY movement.occurred_at DESC
        LIMIT 30
      `
    ]);

    const summary = summaryRows[0] ?? {
      item_count: 0,
      on_hand_quantity: 0,
      available_quantity: 0,
      low_stock_count: 0
    };

    return {
      summary: {
        itemCount: summary.item_count,
        onHandQuantity: summary.on_hand_quantity,
        availableQuantity: summary.available_quantity,
        lowStockCount: summary.low_stock_count
      },
      locations: locations.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        locationKind: row.location_kind,
        countryCode: row.country_code,
        enabled: row.enabled
      })),
      items: items.map((row) => ({
        id: row.id,
        sku: row.sku,
        catalogRelease: row.catalog_release,
        partKey: row.part_key,
        colorKey: row.color_key,
        displayName: row.display_name,
        weightGrams: row.weight_grams,
        unitCostEurMinor: row.unit_cost_eur_minor,
        active: row.active,
        onHandQuantity: row.on_hand_quantity,
        reservedQuantity: row.reserved_quantity,
        damagedQuantity: row.damaged_quantity,
        availableQuantity: row.available_quantity,
        locationCount: row.location_count
      })),
      balances: balances.map((row) => ({
        locationId: row.location_id,
        locationCode: row.location_code,
        locationName: row.location_name,
        itemId: row.item_id,
        sku: row.sku,
        displayName: row.display_name,
        onHandQuantity: row.on_hand_quantity,
        reservedQuantity: row.reserved_quantity,
        damagedQuantity: row.damaged_quantity,
        availableQuantity: row.available_quantity,
        updatedAt: row.updated_at.toISOString()
      })),
      movements: movements.map((row) => ({
        id: row.id,
        locationCode: row.location_code,
        sku: row.sku,
        movementKind: row.movement_kind,
        onHandDelta: row.on_hand_delta,
        reservedDelta: row.reserved_delta,
        damagedDelta: row.damaged_delta,
        reason: row.reason,
        actorName: row.actor_name,
        occurredAt: row.occurred_at.toISOString()
      }))
    };
  });
}
