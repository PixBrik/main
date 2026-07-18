import { randomUUID } from "node:crypto";

import { StatusBadge } from "@/components/status-badge";
import {
  AdjustInventoryStockForm,
  CreateInventoryItemForm,
  CreateInventoryLocationForm
} from "@/components/inventory/inventory-forms";
import { hasPermission, requirePermission } from "@/lib/auth";
import { listInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

type InventoryPageProps = Readonly<{
  searchParams: Promise<{ q?: string | string[] }>;
}>;

function firstSearchValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function signedQuantity(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function moneyFromMinor(value: string | null): string {
  if (value === null) return "Not set";
  return new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(
    Number(value) / 100
  );
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const principal = await requirePermission("inventory.read");
  const query = firstSearchValue((await searchParams).q).trim().slice(0, 100);
  const inventory = await listInventory(principal.userId, query);
  const canManage = hasPermission(principal, "inventory.manage");

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Production / Parts catalog</span>
          <h1>Inventory you can act on.</h1>
          <p>
            Maintain the physical brick catalog, track stock by location and keep every receipt or
            correction in an immutable movement ledger.
          </p>
        </div>
        <div className="inventory-heading-actions">
          <StatusBadge tone={canManage ? "ready" : "pending"}>
            {canManage ? "Stock controls enabled" : "Read only"}
          </StatusBadge>
          {canManage ? (
            <nav className="inventory-quick-actions" aria-label="Inventory actions">
              <a className="staff-button staff-button-primary" href="#record-stock">Receive stock</a>
              <a className="staff-button staff-button-secondary" href="#add-catalog-item">Add item</a>
              <a className="staff-button staff-button-secondary" href="#add-location">Add location</a>
            </nav>
          ) : null}
        </div>
      </div>

      <section className="grid-4" aria-label="Inventory summary">
        <article className="metric-card">
          <span className="eyebrow">Catalog items</span>
          <strong>{inventory.summary.itemCount}</strong>
          <small>{query ? "matching this search" : "active and archived SKUs"}</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">On hand</span>
          <strong>{inventory.summary.onHandQuantity.toLocaleString("en")}</strong>
          <small>physical pieces across matching catalog items</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Available</span>
          <strong>{inventory.summary.availableQuantity.toLocaleString("en")}</strong>
          <small>after reservations and damaged stock</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Needs attention</span>
          <strong>{inventory.summary.lowStockCount}</strong>
          <small>SKUs with no available stock</small>
        </article>
      </section>

      <section className="panel" aria-labelledby="inventory-catalog-title">
        <div className="panel-header inventory-panel-header">
          <div>
            <span className="eyebrow">Searchable catalog</span>
            <h2 id="inventory-catalog-title">Brick inventory</h2>
          </div>
          <form className="inventory-search" method="get" role="search">
            <label className="staff-sr-only" htmlFor="inventory-search">Search inventory</label>
            <input
              id="inventory-search"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={query}
              placeholder="SKU, part, colour or location"
            />
            <button className="staff-button staff-button-secondary" type="submit">Search</button>
            {query ? <a className="staff-text-link" href="?">Clear</a> : null}
          </form>
        </div>

        {inventory.items.length === 0 ? (
          <div className="empty-state inventory-empty-state">
            <div>
              <strong>{query ? "No matching catalog items" : "No catalog items yet"}</strong>
              <span>
                {query
                  ? "Try a different SKU, part name, colour or location."
                  : canManage
                    ? "Use Add catalog item below to create the first inventory record."
                    : "An inventory manager can add the first catalog item."}
              </span>
              {!query && canManage ? (
                <a className="primary-link" href="#add-catalog-item">Add the first catalog item</a>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className="staff-table-scroller"
            tabIndex={0}
            role="region"
            aria-label="Brick inventory table"
          >
            <table className="staff-table inventory-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Catalog identity</th>
                  <th scope="col">On hand</th>
                  <th scope="col">Reserved</th>
                  <th scope="col">Damaged</th>
                  <th scope="col">Available</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {inventory.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.sku}</strong>
                      <small>{item.displayName}</small>
                    </td>
                    <td>
                      <span>{item.partKey} / {item.colorKey}</span>
                      <small>{item.catalogRelease} · {item.locationCount} locations</small>
                    </td>
                    <td className="mono">{item.onHandQuantity.toLocaleString("en")}</td>
                    <td className="mono">{item.reservedQuantity.toLocaleString("en")}</td>
                    <td className="mono">{item.damagedQuantity.toLocaleString("en")}</td>
                    <td className="mono inventory-available-cell">{item.availableQuantity.toLocaleString("en")}</td>
                    <td>
                      <span>{moneyFromMinor(item.unitCostEurMinor)}</span>
                      <small>{item.weightGrams ? `${item.weightGrams} g` : "Weight not set"}</small>
                    </td>
                    <td>
                      <StatusBadge tone={item.active ? "ready" : "blocked"}>
                        {item.active ? "Active" : "Archived"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="inventory-balance-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Location detail</span>
            <h2 id="inventory-balance-title">Balances by location</h2>
          </div>
          <span className="mono">{inventory.locations.length} locations</span>
        </div>
        {inventory.balances.length === 0 ? (
          <p className="inventory-muted-block">No stock has been received at a location yet.</p>
        ) : (
          <div className="inventory-balance-grid">
            {inventory.balances.map((balance) => (
              <article className="inventory-balance-card" key={`${balance.locationId}:${balance.itemId}`}>
                <span className="eyebrow">{balance.locationCode}</span>
                <strong>{balance.sku}</strong>
                <small>{balance.locationName}</small>
                <dl>
                  <div><dt>On hand</dt><dd>{balance.onHandQuantity}</dd></div>
                  <div><dt>Reserved</dt><dd>{balance.reservedQuantity}</dd></div>
                  <div><dt>Damaged</dt><dd>{balance.damagedQuantity}</dd></div>
                  <div><dt>Available</dt><dd>{balance.availableQuantity}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      {canManage ? (
        <>
          <section className="panel" id="record-stock" aria-labelledby="inventory-adjust-title">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Ledger entry</span>
                <h2 id="inventory-adjust-title">Receive or correct stock</h2>
              </div>
              <span className="mono">Append-only</span>
            </div>
            <AdjustInventoryStockForm
              locations={inventory.locations.filter((location) => location.enabled)}
              items={inventory.items.filter((item) => item.active)}
              idempotencyKey={randomUUID()}
            />
          </section>

          <div className="grid-2 inventory-create-grid">
            <section className="panel" id="add-catalog-item" aria-labelledby="inventory-item-create-title">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Parts catalog</span>
                  <h2 id="inventory-item-create-title">Add catalog item</h2>
                </div>
              </div>
              <CreateInventoryItemForm />
            </section>
            <section className="panel" id="add-location" aria-labelledby="inventory-location-create-title">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Stock points</span>
                  <h2 id="inventory-location-create-title">Add location</h2>
                </div>
              </div>
              <CreateInventoryLocationForm />
            </section>
          </div>
        </>
      ) : null}

      <section className="panel" aria-labelledby="inventory-movements-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Audit-safe history</span>
            <h2 id="inventory-movements-title">Recent movements</h2>
          </div>
          <span className="mono">Latest {inventory.movements.length}</span>
        </div>
        {inventory.movements.length === 0 ? (
          <p className="inventory-muted-block">No stock movements have been recorded yet.</p>
        ) : (
          <div
            className="staff-table-scroller"
            tabIndex={0}
            role="region"
            aria-label="Recent inventory movements table"
          >
            <table className="staff-table inventory-movement-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Item / Location</th>
                  <th scope="col">Type</th>
                  <th scope="col">On hand</th>
                  <th scope="col">Reserved</th>
                  <th scope="col">Damaged</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Actor</th>
                </tr>
              </thead>
              <tbody>
                {inventory.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td><time dateTime={movement.occurredAt}>{new Date(movement.occurredAt).toLocaleString("en")}</time></td>
                    <td><strong>{movement.sku}</strong><small>{movement.locationCode}</small></td>
                    <td>{movement.movementKind.replaceAll("_", " ")}</td>
                    <td className="mono">{signedQuantity(movement.onHandDelta)}</td>
                    <td className="mono">{signedQuantity(movement.reservedDelta)}</td>
                    <td className="mono">{signedQuantity(movement.damagedDelta)}</td>
                    <td>{movement.reason ?? "—"}</td>
                    <td>{movement.actorName ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
