import Decimal from 'decimal.js';

/**
 * Period-over-period percent change, shared by all four live KPIs
 * (revenue, net profit, order count, margin). Computed with decimal.js so the
 * Decimal-string inputs keep their precision through the subtraction/division.
 *
 * Returns `null` when `previous` is zero: the relative change is mathematically
 * undefined (dividing by zero), and a "+∞%" chip would be noise. Also returns
 * `null` when either side is `null`: the API sends yesterday's profit and the
 * four ratios as null for a day without a costed order, so there is nothing to
 * compare. The KPI tile omits its TrendDelta chip in those cases. Returns a
 * plain number (percent units, e.g. `25` for +25%) for TrendDelta, which
 * formats and rounds for display.
 *
 * The change is divided by the absolute value of `previous` so the sign always
 * says whether today is better: profit going from -271.30 to +50.56 is an
 * improvement and must read as +118.6%, not -118.6%. Net profit and margin
 * can be negative; revenue and order count never are, so they are unaffected.
 */
export function computeDeltaPercent(
  current: string | null,
  previous: string | null,
): number | null {
  if (current === null || previous === null) {
    return null;
  }
  const prev = new Decimal(previous);
  if (prev.isZero()) {
    return null;
  }
  const curr = new Decimal(current);
  return curr.sub(prev).div(prev.abs()).mul(100).toNumber();
}
