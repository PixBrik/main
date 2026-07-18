import type { SupportedLocale } from './locales';

export const BASE_CURRENCY = 'EUR' as const;
export const SUPPORTED_CURRENCIES = ['EUR', 'GBP', 'USD', 'CAD', 'AUD'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type MinorUnits = number;
export type DecimalValue = string | number;

export interface CurrencyMetadata {
  code: SupportedCurrency;
  fractionDigits: number;
}

export interface Money {
  amountMinor: MinorUnits;
  currency: SupportedCurrency;
}

export const CURRENCY_METADATA: Readonly<Record<SupportedCurrency, CurrencyMetadata>> = {
  EUR: { code: 'EUR', fractionDigits: 2 },
  GBP: { code: 'GBP', fractionDigits: 2 },
  USD: { code: 'USD', fractionDigits: 2 },
  CAD: { code: 'CAD', fractionDigits: 2 },
  AUD: { code: 'AUD', fractionDigits: 2 },
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function currencyFractionDigits(currency: SupportedCurrency): number {
  return CURRENCY_METADATA[currency].fractionDigits;
}

export function assertMinorUnits(value: number): asserts value is MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Money must be represented as a safe integer number of minor units.');
  }
}

interface ParsedDecimal {
  negative: boolean;
  coefficient: bigint;
  scale: number;
}

function parseDecimal(value: DecimalValue): ParsedDecimal {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Decimal value must be finite.');
  }

  const input = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) {
    throw new TypeError(`Invalid decimal value: ${input}`);
  }

  const integerDigits = match[2] ?? '0';
  const fractionDigits = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? '0');
  if (!Number.isSafeInteger(exponent)) {
    throw new RangeError('Decimal exponent is outside the supported range.');
  }

  return {
    negative: match[1] === '-',
    coefficient: BigInt(`${integerDigits}${fractionDigits}`),
    scale: fractionDigits.length - exponent,
  };
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 1_000) {
    throw new RangeError('Decimal scale is outside the supported range.');
  }
  return 10n ** BigInt(exponent);
}

/** Rounds a positive fraction using commercial half-up rounding. */
function divideAndRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function bigintToSafeInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Money amount exceeds the safe integer range.');
  }
  return result;
}

/**
 * Converts an API/admin decimal into integer minor units without binary
 * floating-point multiplication. Extra precision is rounded half-up.
 */
export function toMinorUnits(value: DecimalValue, currency: SupportedCurrency): MinorUnits {
  const decimal = parseDecimal(value);
  const targetScale = currencyFractionDigits(currency);
  const scaleDelta = targetScale - decimal.scale;
  const absolute =
    scaleDelta >= 0
      ? decimal.coefficient * powerOfTen(scaleDelta)
      : divideAndRoundHalfUp(decimal.coefficient, powerOfTen(-scaleDelta));
  return bigintToSafeInteger(decimal.negative ? -absolute : absolute);
}

/** Exact, locale-neutral decimal suitable for persistence and APIs. */
export function minorUnitsToDecimal(amountMinor: MinorUnits, currency: SupportedCurrency): string {
  assertMinorUnits(amountMinor);
  const fractionDigits = currencyFractionDigits(currency);
  const negative = amountMinor < 0;
  const digits = Math.abs(amountMinor).toString().padStart(fractionDigits + 1, '0');
  const integerPart = digits.slice(0, -fractionDigits) || '0';
  const fractionPart = fractionDigits === 0 ? '' : `.${digits.slice(-fractionDigits)}`;
  return `${negative ? '-' : ''}${integerPart}${fractionPart}`;
}

export function formatMoney(
  money: Money,
  locale: SupportedLocale | string,
  options: Pick<Intl.NumberFormatOptions, 'currencyDisplay'> = {},
): string {
  assertMinorUnits(money.amountMinor);
  const divisor = 10 ** currencyFractionDigits(money.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    currencyDisplay: options.currencyDisplay ?? 'symbol',
  }).format(money.amountMinor / divisor);
}

/** Internal exact decimal ratio used by the FX converter. */
export function decimalToRatio(value: DecimalValue): { numerator: bigint; denominator: bigint } {
  const decimal = parseDecimal(value);
  const numeratorBase = decimal.negative ? -decimal.coefficient : decimal.coefficient;
  if (decimal.scale >= 0) {
    return { numerator: numeratorBase, denominator: powerOfTen(decimal.scale) };
  }
  return { numerator: numeratorBase * powerOfTen(-decimal.scale), denominator: 1n };
}

/** Rounds a signed rational number half away from zero into a safe integer. */
export function roundRatioToSafeInteger(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new RangeError('Ratio denominator must be positive.');
  }
  const negative = numerator < 0n;
  const absolute = divideAndRoundHalfUp(negative ? -numerator : numerator, denominator);
  return bigintToSafeInteger(negative ? -absolute : absolute);
}
