import {
  BASE_CURRENCY,
  currencyFractionDigits,
  decimalToRatio,
  roundRatioToSafeInteger,
  type MinorUnits,
  type SupportedCurrency,
} from './currency';

export interface DailyFxSnapshot {
  /** Stable persistence identifier; multiple fetch attempts may share a rate date. */
  id: string;
  baseCurrency: typeof BASE_CURRENCY;
  /** Provider rate date as an ISO calendar date (`YYYY-MM-DD`). */
  effectiveDate: string;
  /** Timestamp at which PixBrik fetched and archived this immutable snapshot. */
  fetchedAt: string;
  source: string;
  /** Decimal strings preserve the provider's precision. EUR is implicitly 1. */
  rates: Partial<Record<Exclude<SupportedCurrency, typeof BASE_CURRENCY>, string>>;
}

export interface FxFreshnessPolicy {
  /** A normally scheduled snapshot is expected within this age. */
  freshForMs: number;
  /** Older snapshots remain usable during weekends/provider outages up to this age. */
  fallbackForMs: number;
  /** Permits small clock differences while rejecting future-dated snapshots. */
  futureToleranceMs: number;
}

export const DEFAULT_FX_FRESHNESS_POLICY: Readonly<FxFreshnessPolicy> = {
  freshForMs: 36 * 60 * 60 * 1_000,
  fallbackForMs: 120 * 60 * 60 * 1_000,
  futureToleranceMs: 5 * 60 * 1_000,
};

export type FxSnapshotFreshness = 'fresh' | 'fallback' | 'expired' | 'future' | 'invalid';

export interface FxSnapshotAssessment {
  freshness: FxSnapshotFreshness;
  ageMs: number | null;
  usable: boolean;
}

export type FxRateResolution =
  | {
      status: 'base';
      currency: typeof BASE_CURRENCY;
      rate: '1';
      snapshot: null;
      ageMs: 0;
    }
  | {
      status: 'fresh' | 'fallback';
      currency: Exclude<SupportedCurrency, typeof BASE_CURRENCY>;
      rate: string;
      snapshot: DailyFxSnapshot;
      ageMs: number;
    }
  | {
      status: 'unavailable';
      currency: SupportedCurrency;
      rate: null;
      snapshot: null;
      ageMs: null;
    };

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

function parseIsoInstant(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  const offset = match[7];
  if (offset !== undefined && offset.toUpperCase() !== 'Z') {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
      return undefined;
    }
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validFreshnessPolicy(policy: FxFreshnessPolicy): boolean {
  return (
    Number.isSafeInteger(policy.freshForMs) &&
    policy.freshForMs >= 0 &&
    Number.isSafeInteger(policy.fallbackForMs) &&
    policy.fallbackForMs >= policy.freshForMs &&
    Number.isSafeInteger(policy.futureToleranceMs) &&
    policy.futureToleranceMs >= 0
  );
}

function isPositiveDecimal(value: string): boolean {
  try {
    const ratio = decimalToRatio(value);
    return ratio.numerator > 0n;
  } catch {
    return false;
  }
}

export function assessFxSnapshot(
  snapshot: DailyFxSnapshot,
  now: Date = new Date(),
  policy: FxFreshnessPolicy = DEFAULT_FX_FRESHNESS_POLICY,
): FxSnapshotAssessment {
  const fetchedAt = parseIsoInstant(snapshot.fetchedAt);
  const effectiveAt = validIsoDate(snapshot.effectiveDate)
    ? Date.parse(`${snapshot.effectiveDate}T00:00:00.000Z`)
    : Number.NaN;
  const nowMs = now.getTime();
  if (
    snapshot.baseCurrency !== BASE_CURRENCY ||
    !snapshot.id ||
    !snapshot.source ||
    !Number.isFinite(effectiveAt) ||
    fetchedAt === undefined ||
    !Number.isFinite(nowMs) ||
    !validFreshnessPolicy(policy)
  ) {
    return { freshness: 'invalid', ageMs: null, usable: false };
  }

  const fetchedAgeMs = nowMs - fetchedAt;
  const effectiveAgeMs = nowMs - effectiveAt;
  if (
    fetchedAgeMs < -policy.futureToleranceMs ||
    effectiveAgeMs < -policy.futureToleranceMs
  ) {
    return {
      freshness: 'future',
      ageMs: Math.min(fetchedAgeMs, effectiveAgeMs),
      usable: false,
    };
  }
  // A freshly fetched snapshot must not refresh an old provider rate date.
  // The older of the fetch timestamp and provider effective date is binding.
  const ageMs = Math.max(fetchedAgeMs, effectiveAgeMs);
  if (ageMs <= policy.freshForMs) {
    return { freshness: 'fresh', ageMs: Math.max(0, ageMs), usable: true };
  }
  if (ageMs <= policy.fallbackForMs) {
    return { freshness: 'fallback', ageMs, usable: true };
  }
  return { freshness: 'expired', ageMs, usable: false };
}

/**
 * Selects the freshest usable snapshot that contains a valid rate for the
 * requested currency. Freshness is bound by both provider date and fetch time,
 * so a late re-fetch cannot make an older rate outrank a current one. A partial
 * provider response therefore cannot erase a still-valid older rate for
 * another currency.
 */
export function resolveFxRate(
  currency: SupportedCurrency,
  snapshots: readonly DailyFxSnapshot[],
  now: Date = new Date(),
  policy: FxFreshnessPolicy = DEFAULT_FX_FRESHNESS_POLICY,
): FxRateResolution {
  if (currency === BASE_CURRENCY) {
    return { status: 'base', currency, rate: '1', snapshot: null, ageMs: 0 };
  }

  const candidates = snapshots
    .map((snapshot) => ({ snapshot, assessment: assessFxSnapshot(snapshot, now, policy) }))
    .filter(({ snapshot, assessment }) => assessment.usable && isPositiveDecimal(snapshot.rates[currency] ?? ''))
    .sort(
      (left, right) =>
        (left.assessment.ageMs ?? Number.POSITIVE_INFINITY) -
          (right.assessment.ageMs ?? Number.POSITIVE_INFINITY) ||
        right.snapshot.effectiveDate.localeCompare(left.snapshot.effectiveDate) ||
        Date.parse(right.snapshot.fetchedAt) - Date.parse(left.snapshot.fetchedAt) ||
        left.snapshot.id.localeCompare(right.snapshot.id),
    );

  const selected = candidates[0];
  if (!selected || selected.assessment.ageMs === null) {
    return { status: 'unavailable', currency, rate: null, snapshot: null, ageMs: null };
  }

  return {
    status: selected.assessment.freshness === 'fresh' ? 'fresh' : 'fallback',
    currency,
    rate: selected.snapshot.rates[currency]!,
    snapshot: selected.snapshot,
    ageMs: selected.assessment.ageMs,
  };
}

/** Converts base EUR minor units using an already resolved, archived rate. */
export function convertEurMinorUnits(
  amountEurMinor: MinorUnits,
  resolution: Exclude<FxRateResolution, { status: 'unavailable' }>,
): MinorUnits {
  if (!Number.isSafeInteger(amountEurMinor)) {
    throw new RangeError('EUR amount must be a safe integer number of minor units.');
  }
  if (resolution.status === 'base') return amountEurMinor;

  const ratio = decimalToRatio(resolution.rate);
  if (ratio.numerator <= 0n) throw new RangeError('FX rate must be positive.');

  const baseFactor = 10n ** BigInt(currencyFractionDigits(BASE_CURRENCY));
  const targetFactor = 10n ** BigInt(currencyFractionDigits(resolution.currency));
  return roundRatioToSafeInteger(
    BigInt(amountEurMinor) * ratio.numerator * targetFactor,
    ratio.denominator * baseFactor,
  );
}
