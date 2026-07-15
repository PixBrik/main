/**
 * Country-based shipping estimator: kit preparation time + transit window →
 * an estimated delivery date range and a shipping cost. Prototype numbers —
 * real carrier rules to be defined later.
 */

interface CountryShipping {
  /** Business-ish days to pick, pack and hand off the kit. */
  handlingDays: number;
  /** Transit window in calendar days. */
  transitMin: number;
  transitMax: number;
  /** Shipping cost in EUR. */
  costEur: number;
}

const SHIPPING: Record<string, CountryShipping> = {
  FR: { handlingDays: 2, transitMin: 2, transitMax: 4, costEur: 4.9 },
  GB: { handlingDays: 2, transitMin: 3, transitMax: 6, costEur: 7.9 },
  US: { handlingDays: 2, transitMin: 6, transitMax: 10, costEur: 12.9 },
};

const DEFAULT_SHIPPING: CountryShipping = { handlingDays: 3, transitMin: 7, transitMax: 14, costEur: 14.9 };

export interface DeliveryEstimate {
  costEur: number;
  earliest: Date;
  latest: Date;
  /** Human range, e.g. "24–28 Jul". */
  rangeLabel: string;
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/** Format a date range compactly, collapsing a shared month. */
function formatRange(earliest: Date, latest: Date): string {
  const month = (date: Date) => date.toLocaleDateString('en-GB', { month: 'short' });
  const day = (date: Date) => date.getDate();
  if (earliest.getMonth() === latest.getMonth()) {
    return `${day(earliest)}–${day(latest)} ${month(latest)}`;
  }
  return `${day(earliest)} ${month(earliest)} – ${day(latest)} ${month(latest)}`;
}

/**
 * @param from base date — pass a stable value; defaults to now in the app.
 */
export function estimateDelivery(countryCode: string, from: Date = new Date()): DeliveryEstimate {
  const rules = SHIPPING[countryCode] ?? DEFAULT_SHIPPING;
  const earliest = addDays(from, rules.handlingDays + rules.transitMin);
  const latest = addDays(from, rules.handlingDays + rules.transitMax);
  return {
    costEur: rules.costEur,
    earliest,
    latest,
    rangeLabel: formatRange(earliest, latest),
  };
}
