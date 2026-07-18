/**
 * Framework-neutral discount rules.
 *
 * All amounts are integer EUR minor units. The caller is responsible for
 * loading usage counts from the authoritative database and committing the
 * redemption, usage counter and order in one transaction. Evaluation alone
 * never reserves a use.
 */

export const DISCOUNT_BASIS_POINTS_SCALE = 10_000;

export type DiscountApplicationChannel =
  | 'checkout'
  | 'exit_intent_popup'
  | 'abandoned_checkout_email'
  | 'admin';

export type DiscountValue =
  | {
      type: 'percentage';
      /** 1 basis point = 0.01%; 10_000 = 100%. */
      rateBasisPoints: number;
      maximumDiscountEurMinor?: number;
    }
  | {
      type: 'fixed_eur';
      amountEurMinor: number;
    };

export type DiscountRedemptionPolicy =
  | {
      mode: 'once_per_customer';
    }
  | {
      mode: 'reusable';
      /** Omit to allow unlimited uses per customer, subject to the global cap. */
      maxUsesPerCustomer?: number;
    };

export interface DiscountEligibility {
  minimumSubtotalEurMinor?: number;
  firstCompletedOrderOnly?: boolean;
  allowedCustomerKeys?: readonly string[];
  allowedCustomerSegmentsAny?: readonly string[];
  allowedMarketCodes?: readonly string[];
  allowedBuildCategoryIdsAny?: readonly string[];
}

export interface DiscountDefinition {
  id: string;
  code: string;
  enabled: boolean;
  value: DiscountValue;
  redemption: DiscountRedemptionPolicy;
  /** Maximum successful uses across all customers. */
  maxGlobalUses?: number;
  /** Inclusive start instant. Must contain a timezone offset or `Z`. */
  validFrom?: string;
  /** Exclusive end instant. Must contain a timezone offset or `Z`. */
  validUntil?: string;
  eligibility?: DiscountEligibility;
}

export interface DiscountUsageSnapshot {
  /** Discount row locked/read for these counters. */
  discountId: string;
  successfulGlobalUses: number;
  /**
   * Successful uses for `customerKey`. This may be omitted only for policies
   * with no per-customer limit. Limited policies fail closed when it is absent.
   * Load this value under the same database lock/transaction used to commit a
   * redemption; evaluation never treats a missing count as zero.
   */
  successfulCustomerUses?: number;
  /** Customer row/key used to load `successfulCustomerUses`, when present. */
  customerKey?: string;
}

export interface DiscountEvaluationContext {
  /** Authoritative subtotal before discounts, in EUR cents (or equivalent minor unit). */
  subtotalEurMinor: number;
  /** Server clock, injected to make the decision deterministic and auditable. */
  nowEpochMs: number;
  /** Stable server-derived customer id/fingerprint; never trust a client-supplied count. */
  customerKey?: string;
  customerSegments?: readonly string[];
  marketCode?: string;
  buildCategoryIds?: readonly string[];
  /** Customer key used for the authoritative completed-order count. */
  completedOrderCountCustomerKey?: string;
  completedOrderCount: number;
  usage: DiscountUsageSnapshot;
}

export type DiscountRejectionCode =
  | 'code_mismatch'
  | 'disabled'
  | 'not_started'
  | 'expired'
  | 'global_limit_reached'
  | 'usage_snapshot_mismatch'
  | 'customer_identity_required'
  | 'customer_usage_snapshot_required'
  | 'customer_activity_snapshot_required'
  | 'customer_limit_reached'
  | 'minimum_subtotal_not_met'
  | 'customer_not_eligible'
  | 'customer_segment_not_eligible'
  | 'market_not_eligible'
  | 'build_category_not_eligible'
  | 'first_order_only';

export type DiscountEvaluation =
  | {
      eligible: false;
      code: DiscountRejectionCode;
      normalizedCode: string;
      subtotalEurMinor: number;
    }
  | {
      eligible: true;
      discountId: string;
      normalizedCode: string;
      discountEurMinor: number;
      subtotalEurMinor: number;
      subtotalAfterDiscountEurMinor: number;
      value: DiscountValue;
    };

export function normalizeDiscountCode(code: string): string {
  return code.trim().toLocaleUpperCase('en-US');
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function hasTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function parseInstant(value: string): number | undefined {
  if (!hasTimezone(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateOptionalAllowList(
  issues: string[],
  values: readonly string[] | undefined,
  field: string,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    issues.push(`${field} must not be empty when provided`);
    return;
  }
  if (values.some((value) => value.trim().length === 0)) {
    issues.push(`${field} must contain only non-empty values`);
  }
}

/** Returns configuration errors suitable for an admin validation response. */
export function validateDiscountDefinition(definition: DiscountDefinition): readonly string[] {
  const issues: string[] = [];
  if (definition.id.trim().length === 0) issues.push('id is required');
  if (normalizeDiscountCode(definition.code).length === 0) issues.push('code is required');

  if (definition.value.type === 'percentage') {
    if (
      !isPositiveInteger(definition.value.rateBasisPoints) ||
      definition.value.rateBasisPoints > DISCOUNT_BASIS_POINTS_SCALE
    ) {
      issues.push('percentage rateBasisPoints must be an integer from 1 to 10_000');
    }
    if (
      definition.value.maximumDiscountEurMinor !== undefined &&
      !isPositiveInteger(definition.value.maximumDiscountEurMinor)
    ) {
      issues.push('maximumDiscountEurMinor must be a positive safe integer');
    }
  } else if (!isPositiveInteger(definition.value.amountEurMinor)) {
    issues.push('fixed amountEurMinor must be a positive safe integer');
  }

  if (
    definition.maxGlobalUses !== undefined &&
    !isPositiveInteger(definition.maxGlobalUses)
  ) {
    issues.push('maxGlobalUses must be a positive safe integer');
  }
  if (
    definition.redemption.mode === 'reusable' &&
    definition.redemption.maxUsesPerCustomer !== undefined &&
    !isPositiveInteger(definition.redemption.maxUsesPerCustomer)
  ) {
    issues.push('maxUsesPerCustomer must be a positive safe integer');
  }

  const validFrom = definition.validFrom === undefined
    ? undefined
    : parseInstant(definition.validFrom);
  const validUntil = definition.validUntil === undefined
    ? undefined
    : parseInstant(definition.validUntil);
  if (definition.validFrom !== undefined && validFrom === undefined) {
    issues.push('validFrom must be a valid timestamp with an explicit timezone');
  }
  if (definition.validUntil !== undefined && validUntil === undefined) {
    issues.push('validUntil must be a valid timestamp with an explicit timezone');
  }
  if (validFrom !== undefined && validUntil !== undefined && validFrom >= validUntil) {
    issues.push('validUntil must be later than validFrom');
  }

  const eligibility = definition.eligibility;
  if (
    eligibility?.minimumSubtotalEurMinor !== undefined &&
    !isNonNegativeInteger(eligibility.minimumSubtotalEurMinor)
  ) {
    issues.push('minimumSubtotalEurMinor must be a non-negative safe integer');
  }
  validateOptionalAllowList(issues, eligibility?.allowedCustomerKeys, 'allowedCustomerKeys');
  validateOptionalAllowList(
    issues,
    eligibility?.allowedCustomerSegmentsAny,
    'allowedCustomerSegmentsAny',
  );
  validateOptionalAllowList(issues, eligibility?.allowedMarketCodes, 'allowedMarketCodes');
  validateOptionalAllowList(
    issues,
    eligibility?.allowedBuildCategoryIdsAny,
    'allowedBuildCategoryIdsAny',
  );
  return issues;
}

export function assertValidDiscountDefinition(definition: DiscountDefinition): void {
  const issues = validateDiscountDefinition(definition);
  if (issues.length > 0) {
    throw new Error(`Invalid discount definition: ${issues.join('; ')}`);
  }
}

function validateEvaluationContext(context: DiscountEvaluationContext): void {
  if (!isNonNegativeInteger(context.subtotalEurMinor)) {
    throw new Error('subtotalEurMinor must be a non-negative safe integer');
  }
  if (!isNonNegativeInteger(context.completedOrderCount)) {
    throw new Error('completedOrderCount must be a non-negative safe integer');
  }
  if (!isNonNegativeInteger(context.usage.successfulGlobalUses)) {
    throw new Error('successfulGlobalUses must be a non-negative safe integer');
  }
  if (
    context.usage.successfulCustomerUses !== undefined &&
    !isNonNegativeInteger(context.usage.successfulCustomerUses)
  ) {
    throw new Error('successfulCustomerUses must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(context.nowEpochMs) || context.nowEpochMs < 0) {
    throw new Error('nowEpochMs must be a non-negative safe integer');
  }
}

function rejected(
  code: DiscountRejectionCode,
  normalizedCode: string,
  subtotalEurMinor: number,
): DiscountEvaluation {
  return { code, eligible: false, normalizedCode, subtotalEurMinor };
}

function hasAny(values: readonly string[] | undefined, allowed: readonly string[]): boolean {
  if (!values) return false;
  const actual = new Set(values);
  return allowed.some((value) => actual.has(value));
}

function stableCustomerKey(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 && value.trim() === value
    ? value
    : undefined;
}

function percentageAmount(subtotalEurMinor: number, rateBasisPoints: number): number {
  // Integer half-up rounding avoids floating-point differences between runtimes.
  const numerator =
    BigInt(subtotalEurMinor) * BigInt(rateBasisPoints) +
    BigInt(DISCOUNT_BASIS_POINTS_SCALE / 2);
  return Number(numerator / BigInt(DISCOUNT_BASIS_POINTS_SCALE));
}

/**
 * Makes a deterministic discount decision using server-loaded state.
 *
 * For a real redemption, re-read/lock the definition and usage counters and
 * call this function inside the same database transaction that writes the
 * order and redemption event. This prevents concurrent requests exceeding a
 * usage cap.
 */
export function evaluateDiscount(
  definition: DiscountDefinition,
  submittedCode: string,
  context: DiscountEvaluationContext,
): DiscountEvaluation {
  assertValidDiscountDefinition(definition);
  validateEvaluationContext(context);

  const normalizedCode = normalizeDiscountCode(submittedCode);
  if (normalizedCode !== normalizeDiscountCode(definition.code)) {
    return rejected('code_mismatch', normalizedCode, context.subtotalEurMinor);
  }
  if (!definition.enabled) {
    return rejected('disabled', normalizedCode, context.subtotalEurMinor);
  }

  const validFrom = definition.validFrom === undefined
    ? undefined
    : parseInstant(definition.validFrom);
  const validUntil = definition.validUntil === undefined
    ? undefined
    : parseInstant(definition.validUntil);
  if (validFrom !== undefined && context.nowEpochMs < validFrom) {
    return rejected('not_started', normalizedCode, context.subtotalEurMinor);
  }
  if (validUntil !== undefined && context.nowEpochMs >= validUntil) {
    return rejected('expired', normalizedCode, context.subtotalEurMinor);
  }
  if (context.usage.discountId !== definition.id) {
    return rejected('usage_snapshot_mismatch', normalizedCode, context.subtotalEurMinor);
  }
  if (
    definition.maxGlobalUses !== undefined &&
    context.usage.successfulGlobalUses >= definition.maxGlobalUses
  ) {
    return rejected('global_limit_reached', normalizedCode, context.subtotalEurMinor);
  }

  const customerLimit = definition.redemption.mode === 'once_per_customer'
    ? 1
    : definition.redemption.maxUsesPerCustomer;
  if (customerLimit !== undefined) {
    const customerKey = stableCustomerKey(context.customerKey);
    if (!customerKey) {
      return rejected('customer_identity_required', normalizedCode, context.subtotalEurMinor);
    }
    if (context.usage.successfulCustomerUses === undefined) {
      return rejected(
        'customer_usage_snapshot_required',
        normalizedCode,
        context.subtotalEurMinor,
      );
    }
    if (context.usage.customerKey !== customerKey) {
      return rejected('usage_snapshot_mismatch', normalizedCode, context.subtotalEurMinor);
    }
    if (context.usage.successfulCustomerUses >= customerLimit) {
      return rejected('customer_limit_reached', normalizedCode, context.subtotalEurMinor);
    }
  }

  const eligibility = definition.eligibility;
  if (
    eligibility?.minimumSubtotalEurMinor !== undefined &&
    context.subtotalEurMinor < eligibility.minimumSubtotalEurMinor
  ) {
    return rejected('minimum_subtotal_not_met', normalizedCode, context.subtotalEurMinor);
  }
  if (
    eligibility?.allowedCustomerKeys &&
    (!context.customerKey || !eligibility.allowedCustomerKeys.includes(context.customerKey))
  ) {
    return rejected('customer_not_eligible', normalizedCode, context.subtotalEurMinor);
  }
  if (
    eligibility?.allowedCustomerSegmentsAny &&
    !hasAny(context.customerSegments, eligibility.allowedCustomerSegmentsAny)
  ) {
    return rejected('customer_segment_not_eligible', normalizedCode, context.subtotalEurMinor);
  }
  if (
    eligibility?.allowedMarketCodes &&
    (!context.marketCode || !eligibility.allowedMarketCodes.includes(context.marketCode))
  ) {
    return rejected('market_not_eligible', normalizedCode, context.subtotalEurMinor);
  }
  if (
    eligibility?.allowedBuildCategoryIdsAny &&
    !hasAny(context.buildCategoryIds, eligibility.allowedBuildCategoryIdsAny)
  ) {
    return rejected('build_category_not_eligible', normalizedCode, context.subtotalEurMinor);
  }
  if (eligibility?.firstCompletedOrderOnly) {
    const customerKey = stableCustomerKey(context.customerKey);
    if (!customerKey) {
      return rejected('customer_identity_required', normalizedCode, context.subtotalEurMinor);
    }
    if (context.completedOrderCountCustomerKey !== customerKey) {
      return rejected(
        'customer_activity_snapshot_required',
        normalizedCode,
        context.subtotalEurMinor,
      );
    }
    if (context.completedOrderCount > 0) {
      return rejected('first_order_only', normalizedCode, context.subtotalEurMinor);
    }
  }

  let discountEurMinor: number;
  if (definition.value.type === 'fixed_eur') {
    discountEurMinor = definition.value.amountEurMinor;
  } else {
    discountEurMinor = percentageAmount(
      context.subtotalEurMinor,
      definition.value.rateBasisPoints,
    );
    if (definition.value.maximumDiscountEurMinor !== undefined) {
      discountEurMinor = Math.min(
        discountEurMinor,
        definition.value.maximumDiscountEurMinor,
      );
    }
  }
  discountEurMinor = Math.min(discountEurMinor, context.subtotalEurMinor);

  return {
    discountEurMinor,
    discountId: definition.id,
    eligible: true,
    normalizedCode,
    subtotalAfterDiscountEurMinor: context.subtotalEurMinor - discountEurMinor,
    subtotalEurMinor: context.subtotalEurMinor,
    value: definition.value,
  };
}

/** Immutable fact appended only after a successful, committed order redemption. */
export interface DiscountRedemptionEvent {
  id: string;
  discountId: string;
  orderId: string;
  customerKey: string;
  channel: DiscountApplicationChannel;
  occurredAtEpochMs: number;
  subtotalBeforeDiscountEurMinor: number;
  discountEurMinor: number;
  subtotalAfterDiscountEurMinor: number;
}

export interface DiscountUsageStats {
  discountId: string;
  successfulUses: number;
  uniqueCustomers: number;
  firstUsedAtEpochMs?: number;
  lastUsedAtEpochMs?: number;
  subtotalBeforeDiscountEurMinor: number;
  discountsGrantedEurMinor: number;
  subtotalAfterDiscountEurMinor: number;
  averageOrderValueBeforeDiscountEurMinor: number;
  usesByChannel: Readonly<Record<DiscountApplicationChannel, number>>;
}

function roundedAverage(total: number, count: number): number {
  if (count === 0) return 0;
  return Number((BigInt(total) + BigInt(Math.floor(count / 2))) / BigInt(count));
}

/** Derives code usage statistics from immutable redemption facts. */
export function summarizeDiscountUsage(
  events: readonly DiscountRedemptionEvent[],
  discountId: string,
): DiscountUsageStats {
  const matching = events.filter((event) => event.discountId === discountId);
  const customers = new Set<string>();
  const usesByChannel: Record<DiscountApplicationChannel, number> = {
    abandoned_checkout_email: 0,
    admin: 0,
    checkout: 0,
    exit_intent_popup: 0,
  };
  let before = 0;
  let discounts = 0;
  let after = 0;
  let first: number | undefined;
  let last: number | undefined;
  const redemptionIds = new Set<string>();

  for (const event of matching) {
    if (
      event.id.trim().length === 0 ||
      event.orderId.trim().length === 0 ||
      event.customerKey.trim().length === 0
    ) {
      throw new Error('Discount redemption events require id, orderId and customerKey');
    }
    if (redemptionIds.has(event.id)) {
      throw new Error(`Duplicate discount redemption event ${event.id}`);
    }
    redemptionIds.add(event.id);
    if (
      !isNonNegativeInteger(event.subtotalBeforeDiscountEurMinor) ||
      !isNonNegativeInteger(event.discountEurMinor) ||
      !isNonNegativeInteger(event.subtotalAfterDiscountEurMinor) ||
      event.subtotalBeforeDiscountEurMinor - event.discountEurMinor !==
        event.subtotalAfterDiscountEurMinor
    ) {
      throw new Error(`Invalid EUR totals in discount redemption ${event.id}`);
    }
    if (!Number.isSafeInteger(event.occurredAtEpochMs) || event.occurredAtEpochMs < 0) {
      throw new Error(`Invalid timestamp in discount redemption ${event.id}`);
    }
    if (!(event.channel in usesByChannel)) {
      throw new Error(`Invalid channel in discount redemption ${event.id}`);
    }
    customers.add(event.customerKey);
    usesByChannel[event.channel] += 1;
    before += event.subtotalBeforeDiscountEurMinor;
    discounts += event.discountEurMinor;
    after += event.subtotalAfterDiscountEurMinor;
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(discounts) || !Number.isSafeInteger(after)) {
      throw new Error('Discount usage totals exceed safe integer precision');
    }
    first = first === undefined ? event.occurredAtEpochMs : Math.min(first, event.occurredAtEpochMs);
    last = last === undefined ? event.occurredAtEpochMs : Math.max(last, event.occurredAtEpochMs);
  }

  return {
    averageOrderValueBeforeDiscountEurMinor: roundedAverage(before, matching.length),
    discountId,
    discountsGrantedEurMinor: discounts,
    firstUsedAtEpochMs: first,
    lastUsedAtEpochMs: last,
    subtotalAfterDiscountEurMinor: after,
    subtotalBeforeDiscountEurMinor: before,
    successfulUses: matching.length,
    uniqueCustomers: customers.size,
    usesByChannel,
  };
}
