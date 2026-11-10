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
  return curr.sub(prev).div(prev).mul(100).toNumber();
}
