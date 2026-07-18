export const LAUNCH_CONFIG = {
  ownerEmail: "sam@benisty.ca",
  legalEntity: {
    displayName: "PixBrik",
    registeredAddress: "173 rue de Courcelles, 75017 Paris, France"
  },
  locales: [
    { code: "en", label: "English", direction: "ltr" },
    { code: "fr", label: "Français", direction: "ltr" },
    { code: "es", label: "Español", direction: "ltr" },
    { code: "it", label: "Italiano", direction: "ltr" },
    { code: "ar", label: "العربية", direction: "rtl" }
  ],
  baseCurrency: "EUR",
  presentmentCurrencies: ["EUR", "GBP", "USD", "CAD", "AUD"],
  markets: ["European Union", "United Kingdom", "United States", "Canada", "Australia", "Middle East"],
  shippingZones: [
    { name: "European Union", countries: "EU member states" },
    { name: "United Kingdom", countries: "GB" },
    { name: "North America", countries: "US, CA" },
    { name: "Australia", countries: "AU" },
    { name: "Middle East", countries: "SA, AE, BH, OM" }
  ],
  contactRecipient: "hello@pixbrik.com"
} as const;

export type LocaleCode = (typeof LAUNCH_CONFIG.locales)[number]["code"];

export const ADMIN_SECTIONS = [
  { key: "orders", label: "Orders", description: "Review, production, billing and fulfilment" },
  { key: "customers", label: "Customers", description: "Accounts, requests and order history" },
  { key: "builds", label: "Build queue", description: "3D reviews, retakes, brick proposals and QC" },
  { key: "models", label: "Model library", description: "Version, categorize, approve and publish assets" },
  { key: "inventory", label: "Inventory", description: "Parts, reservations, movements and replenishment" },
  { key: "markets", label: "Markets & shipping", description: "Locales, currencies, zones, rates and origins" },
  { key: "discounts", label: "Discounts", description: "Coupons, recovery campaigns and usage" },
  { key: "affiliates", label: "Affiliates", description: "Attribution, commissions and payout holds" },
  { key: "analytics", label: "Analytics", description: "Funnels, orders, AOV, margin and operations" },
  { key: "settings", label: "Settings", description: "Staff, permissions, integrations and audit" }
] as const;

export const COMPLIANCE_GATES = [
  {
    name: "VAT and international tax",
    status: "blocked",
    detail: "Obtain market-specific tax advice and configure evidence-based tax calculation before checkout."
  },
  {
    name: "Returns, cancellation and credits",
    status: "blocked",
    detail: "Counsel must review mandatory consumer rights in every destination; blanket waivers are not encoded."
  },
  {
    name: "Toy/product safety and CE",
    status: "blocked",
    detail: "Complete product classification, conformity, testing, traceability and warning review before sale."
  },
  {
    name: "Brand and compatibility claims",
    status: "blocked",
    detail: "Approve independent-brand wording and substantiated compatibility notices without implying affiliation."
  }
] as const;
