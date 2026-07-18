import type { MinorUnits } from './currency';
import { countryToShippingZone, normalizeCountryCode, type ShippingZoneId } from './markets';

export type ShippingDayType = 'business' | 'calendar';
export type OriginCustomerVisibility = 'hidden' | 'country-only' | 'full';

export interface ShippingOrigin {
  id: string;
  internalName: string;
  active: boolean;
  countryCode: string;
  region?: string;
  city?: string;
  postalCode?: string;
  /** Controls storefront exposure independently of operational address data. */
  customerVisibility: OriginCustomerVisibility;
}

export interface ShippingDeliveryWindow {
  handlingMinDays: number;
  handlingMaxDays: number;
  transitMinDays: number;
  transitMaxDays: number;
  dayType: ShippingDayType;
}

/**
 * Packed parcel dimensions. Callers may provide axes in any orientation;
 * matching canonicalizes them from longest to shortest side.
 */
export interface ShippingPackageDimensionsMm {
  length: number;
  width: number;
  height: number;
}

export interface ShippingRuleConditions {
  /** Optional allow-list inside the selected zone. */
  countryCodes?: readonly string[];
  excludedCountryCodes?: readonly string[];
  minSubtotalEurMinor?: MinorUnits;
  maxSubtotalEurMinor?: MinorUnits;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  minItemCount?: number;
  maxItemCount?: number;
  /** Canonical longest-side range after parcel dimensions are sorted. */
  minLengthMm?: number;
  maxLengthMm?: number;
  /** Canonical middle-side range after parcel dimensions are sorted. */
  minWidthMm?: number;
  maxWidthMm?: number;
  /** Canonical shortest-side range after parcel dimensions are sorted. */
  minHeightMm?: number;
  maxHeightMm?: number;
}

export interface ShippingRule {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  /** Higher numbers win when multiple rules match. */
  priority: number;
  zoneId: ShippingZoneId;
  serviceCode: string;
  priceEurMinor: MinorUnits;
  conditions: ShippingRuleConditions;
  deliveryWindow: ShippingDeliveryWindow;
  originIds?: readonly string[];
  effectiveFrom?: string;
  effectiveUntil?: string;
  updatedAt: string;
}

export interface ShippingQuoteContext {
  countryCode: string;
  subtotalEurMinor: MinorUnits;
  weightGrams: number;
  itemCount: number;
  /** Required packed dimensions; a missing or invalid value fails closed. */
  dimensionsMm: ShippingPackageDimensionsMm;
  /** Required when a matched rule is restricted to one or more origins. */
  originId?: string;
  at?: Date;
}

function inOptionalRange(value: number, minimum?: number, maximum?: number): boolean {
  return (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
}

function validOptionalRange(
  minimum: number | undefined,
  maximum: number | undefined,
  minimumAllowed: number,
): boolean {
  return (
    (minimum === undefined || (Number.isFinite(minimum) && minimum >= minimumAllowed)) &&
    (maximum === undefined || (Number.isFinite(maximum) && maximum >= minimumAllowed)) &&
    (minimum === undefined || maximum === undefined || minimum <= maximum)
  );
}

function canonicalDimensions(
  dimensions: ShippingPackageDimensionsMm | undefined,
): ShippingPackageDimensionsMm | null {
  if (!dimensions) return null;
  const sides = [dimensions.length, dimensions.width, dimensions.height];
  if (sides.some((side) => !Number.isFinite(side) || side <= 0)) return null;
  sides.sort((left, right) => right - left);
  return { length: sides[0]!, width: sides[1]!, height: sides[2]! };
}

function hasValidConditionRanges(conditions: ShippingRuleConditions): boolean {
  return (
    validOptionalRange(conditions.minSubtotalEurMinor, conditions.maxSubtotalEurMinor, 0) &&
    validOptionalRange(conditions.minWeightGrams, conditions.maxWeightGrams, 0) &&
    validOptionalRange(conditions.minItemCount, conditions.maxItemCount, 1) &&
    validOptionalRange(conditions.minLengthMm, conditions.maxLengthMm, 0) &&
    validOptionalRange(conditions.minWidthMm, conditions.maxWidthMm, 0) &&
    validOptionalRange(conditions.minHeightMm, conditions.maxHeightMm, 0)
  );
}

function isEffectiveAt(rule: ShippingRule, at: Date): boolean {
  const timestamp = at.getTime();
  const from = rule.effectiveFrom ? Date.parse(rule.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const until = rule.effectiveUntil ? Date.parse(rule.effectiveUntil) : Number.POSITIVE_INFINITY;
  return Number.isFinite(timestamp) && !Number.isNaN(from) && !Number.isNaN(until) && timestamp >= from && timestamp <= until;
}

export function shippingRuleMatches(rule: ShippingRule, context: ShippingQuoteContext): boolean {
  if (!rule.enabled || !Number.isSafeInteger(rule.priceEurMinor) || rule.priceEurMinor < 0) return false;
  if (!Number.isSafeInteger(rule.priority) || !hasValidConditionRanges(rule.conditions)) return false;
  if (rule.serviceCode.trim().length === 0) return false;
  if (!Number.isSafeInteger(context.subtotalEurMinor) || context.subtotalEurMinor < 0) return false;
  if (!Number.isFinite(context.weightGrams) || context.weightGrams < 0) return false;
  if (!Number.isSafeInteger(context.itemCount) || context.itemCount < 1) return false;
  const dimensions = canonicalDimensions(context.dimensionsMm);
  if (!dimensions) return false;

  const countryCode = normalizeCountryCode(context.countryCode);
  if (countryToShippingZone(countryCode) !== rule.zoneId) return false;

  const allowed = rule.conditions.countryCodes?.map(normalizeCountryCode);
  const excluded = rule.conditions.excludedCountryCodes?.map(normalizeCountryCode);
  if (allowed && !allowed.includes(countryCode)) return false;
  if (excluded?.includes(countryCode)) return false;
  if (
    rule.originIds !== undefined &&
    (rule.originIds.length === 0 ||
      !context.originId ||
      !rule.originIds.includes(context.originId))
  ) {
    return false;
  }

  if (
    !inOptionalRange(
      context.subtotalEurMinor,
      rule.conditions.minSubtotalEurMinor,
      rule.conditions.maxSubtotalEurMinor,
    ) ||
    !inOptionalRange(context.weightGrams, rule.conditions.minWeightGrams, rule.conditions.maxWeightGrams) ||
    !inOptionalRange(context.itemCount, rule.conditions.minItemCount, rule.conditions.maxItemCount) ||
    !inOptionalRange(dimensions.length, rule.conditions.minLengthMm, rule.conditions.maxLengthMm) ||
    !inOptionalRange(dimensions.width, rule.conditions.minWidthMm, rule.conditions.maxWidthMm) ||
    !inOptionalRange(dimensions.height, rule.conditions.minHeightMm, rule.conditions.maxHeightMm)
  ) {
    return false;
  }

  return isEffectiveAt(rule, context.at ?? new Date());
}

export class AmbiguousShippingRulesError extends Error {
  readonly serviceCode: string;
  readonly ruleIds: readonly string[];

  constructor(serviceCode: string, ruleIds: readonly string[]) {
    super(`Ambiguous active shipping rules for service ${serviceCode}: ${ruleIds.join(', ')}`);
    this.name = 'AmbiguousShippingRulesError';
    this.serviceCode = serviceCode;
    this.ruleIds = ruleIds;
  }
}

/**
 * Returns one winning rule per service in deterministic priority order.
 * Higher-priority rules override broader rules for the same service. A tie at
 * the winning priority is rejected instead of silently choosing a quote.
 */
export function matchingShippingRules(
  rules: readonly ShippingRule[],
  context: ShippingQuoteContext,
): ShippingRule[] {
  const byService = new Map<string, ShippingRule[]>();
  for (const rule of rules.filter((candidate) => shippingRuleMatches(candidate, context))) {
    const serviceKey = rule.serviceCode.trim().toLocaleUpperCase('en-US');
    const serviceRules = byService.get(serviceKey) ?? [];
    serviceRules.push(rule);
    byService.set(serviceKey, serviceRules);
  }

  const winners: ShippingRule[] = [];
  for (const [serviceCode, serviceRules] of byService) {
    const winningPriority = Math.max(...serviceRules.map((rule) => rule.priority));
    const tiedWinners = serviceRules
      .filter((rule) => rule.priority === winningPriority)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (tiedWinners.length !== 1) {
      throw new AmbiguousShippingRulesError(
        serviceCode,
        tiedWinners.map((rule) => rule.id),
      );
    }
    winners.push(tiedWinners[0]!);
  }

  return winners.sort(
    (left, right) =>
      right.priority - left.priority ||
      left.priceEurMinor - right.priceEurMinor ||
      left.serviceCode.localeCompare(right.serviceCode) ||
      left.id.localeCompare(right.id),
  );
}
