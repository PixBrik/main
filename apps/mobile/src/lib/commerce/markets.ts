import type { SupportedCurrency } from './currency';
import type { SupportedLocale } from './locales';

export const MARKET_IDS = ['eu', 'uk', 'us', 'canada', 'australia', 'middle-east'] as const;
export const SHIPPING_ZONE_IDS = ['eu', 'uk', 'north-america', 'australia', 'middle-east'] as const;

export type MarketId = (typeof MARKET_IDS)[number];
export type ShippingZoneId = (typeof SHIPPING_ZONE_IDS)[number];

export const EU_COUNTRY_CODES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
] as const;

export const MIDDLE_EAST_COUNTRY_CODES = ['SA', 'AE', 'BH', 'OM'] as const;
export const NORTH_AMERICA_COUNTRY_CODES = ['US', 'CA'] as const;

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  UK: 'GB',
  GBR: 'GB',
  USA: 'US',
  CAN: 'CA',
  AUS: 'AU',
  KSA: 'SA',
  SAU: 'SA',
  UAE: 'AE',
  ARE: 'AE',
  BHR: 'BH',
  OMN: 'OM',
};

export interface MarketDefinition {
  id: MarketId;
  name: string;
  shippingZoneId: ShippingZoneId;
  /** An opaque reference to separately reviewed tax configuration. */
  taxPolicyId: string | null;
  suggestedLocale: SupportedLocale;
  suggestedCurrency: SupportedCurrency;
}

/**
 * These definitions intentionally contain no tax rates. Tax registration,
 * place-of-supply, product classification, and customer status must be handled
 * by reviewed, versioned tax policies rather than inferred from a market ID.
 */
export const MARKET_DEFINITIONS: Readonly<Record<MarketId, MarketDefinition>> = {
  eu: {
    id: 'eu',
    name: 'European Union',
    shippingZoneId: 'eu',
    taxPolicyId: null,
    suggestedLocale: 'en',
    suggestedCurrency: 'EUR',
  },
  uk: {
    id: 'uk',
    name: 'United Kingdom',
    shippingZoneId: 'uk',
    taxPolicyId: null,
    suggestedLocale: 'en',
    suggestedCurrency: 'GBP',
  },
  us: {
    id: 'us',
    name: 'United States',
    shippingZoneId: 'north-america',
    taxPolicyId: null,
    suggestedLocale: 'en',
    suggestedCurrency: 'USD',
  },
  canada: {
    id: 'canada',
    name: 'Canada',
    shippingZoneId: 'north-america',
    taxPolicyId: null,
    suggestedLocale: 'en',
    suggestedCurrency: 'CAD',
  },
  australia: {
    id: 'australia',
    name: 'Australia',
    shippingZoneId: 'australia',
    taxPolicyId: null,
    suggestedLocale: 'en',
    suggestedCurrency: 'AUD',
  },
  'middle-east': {
    id: 'middle-east',
    name: 'Middle East',
    shippingZoneId: 'middle-east',
    taxPolicyId: null,
    suggestedLocale: 'ar',
    suggestedCurrency: 'EUR',
  },
};

export function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

export function countryToShippingZone(value: string): ShippingZoneId | null {
  const countryCode = normalizeCountryCode(value);
  if ((EU_COUNTRY_CODES as readonly string[]).includes(countryCode)) return 'eu';
  if (countryCode === 'GB') return 'uk';
  if ((NORTH_AMERICA_COUNTRY_CODES as readonly string[]).includes(countryCode)) return 'north-america';
  if (countryCode === 'AU') return 'australia';
  if ((MIDDLE_EAST_COUNTRY_CODES as readonly string[]).includes(countryCode)) return 'middle-east';
  return null;
}

export function countryToMarket(value: string): MarketId | null {
  const countryCode = normalizeCountryCode(value);
  if ((EU_COUNTRY_CODES as readonly string[]).includes(countryCode)) return 'eu';
  if (countryCode === 'GB') return 'uk';
  if (countryCode === 'US') return 'us';
  if (countryCode === 'CA') return 'canada';
  if (countryCode === 'AU') return 'australia';
  if ((MIDDLE_EAST_COUNTRY_CODES as readonly string[]).includes(countryCode)) return 'middle-east';
  return null;
}
