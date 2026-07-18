export const PERMISSIONS = [
  "dashboard.read",
  "orders.read",
  "orders.manage",
  "customers.read",
  "customers.manage",
  "builds.read",
  "builds.review",
  "models.read",
  "models.publish",
  "inventory.read",
  "inventory.manage",
  "markets.read",
  "markets.manage",
  "discounts.read",
  "discounts.manage",
  "affiliates.read",
  "affiliates.manage",
  "analytics.read",
  "exports.create",
  "settings.read",
  "settings.manage",
  "staff.manage",
  "audit.read"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SECTION_PERMISSION = {
  orders: "orders.read",
  customers: "customers.read",
  builds: "builds.read",
  models: "models.read",
  inventory: "inventory.read",
  markets: "markets.read",
  discounts: "discounts.read",
  affiliates: "affiliates.read",
  analytics: "analytics.read",
  settings: "settings.read"
} satisfies Record<string, Permission>;
