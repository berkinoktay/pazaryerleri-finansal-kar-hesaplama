/**
 * Exact ordering of two `toFixed`-style decimal strings ("50.00", "-0.30",
 * "1234.5") WITHOUT floating point — the engine's money values are compared
 * digit-for-digit so a hair's-width difference never rounds away. Returns a
 * negative number when `a < b`, `0` when the two are numerically equal (so "0.00"
 * and "-0.00" tie), and a positive number when `a > b`.
 *
 * This is NOT arithmetic — it is a pure comparator. The frontend never computes
 * money (feedback_no_frontend_financial_calculation); ranking already-computed
 * figures to pick a winner is the only thing it does with them.
 */
export function compareFixedDecimal(a: string, b: string): number {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.frac.length, pb.frac.length);
  const na = toScaledBigInt(pa, scale);
  const nb = toScaledBigInt(pb, scale);
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

interface ParsedDecimal {
  negative: boolean;
  /** Absolute integer digits (no sign, may be ""). */
  int: string;
  /** Absolute fraction digits (no sign, may be ""). */
  frac: string;
}

function parseDecimal(value: string): ParsedDecimal {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  if (dot === -1) return { negative, int: unsigned, frac: '' };
  return { negative, int: unsigned.slice(0, dot), frac: unsigned.slice(dot + 1) };
}

/**
 * Whole value as a signed BigInt scaled to `scale` fraction digits. BigInt has no
 * negative zero, so "0.00" and "-0.00" both collapse to `0n` and compare equal.
 */
function toScaledBigInt(parsed: ParsedDecimal, scale: number): bigint {
  const frac = (parsed.frac + '0'.repeat(scale)).slice(0, scale);
  const magnitude = BigInt(`${parsed.int === '' ? '0' : parsed.int}${frac}`);
  return parsed.negative ? -magnitude : magnitude;
}

/** A `toFixed`-style money string is a winning candidate only when strictly above zero. */
function isPositiveProfit(netProfit: string): boolean {
  return compareFixedDecimal(netProfit, '0.00') > 0;
}

/**
 * The minimal row shape the resolver ranks: the CURRENT-scenario net profit plus an
 * ordered list of option candidates keyed by an opaque string. Structural on purpose —
 * BOTH the commission vertical (its `CommissionTariffRow`, whose four `band1`..`band4`
 * bands are the candidates) AND the Plus vertical (a single `{ key: 'plus' }` offer)
 * satisfy it, so the two share one winner resolver. The key is a plain `string`: the
 * caller maps it back to whatever option it represents.
 */
export interface BestChoiceRow {
  currentNetProfit: string | null;
  bands: readonly { key: string; netProfit: string | null }[];
}

/**
 * Which single option in a tariff row earns the seller the most — their CURRENT
 * price/commission, one of the preset option BANDS (a commission price band, or the
 * single Plus offer), or the CUSTOM price they typed — returned as the key the row
 * marks with ONE "En kârlı" badge: `'current'`, `'custom'`, or a band key
 * (`'band1'`..`'band4'` for commission, `'plus'` for Plus). `null` when NO option is
 * strictly profitable (a loss is never crowned "most profitable" — the row then shows
 * no badge).
 *
 * The custom candidate is passed as its already-computed net-profit string
 * (`customNetProfit`), NOT the whole `CustomChoice`: the caller decides which
 * figure competes — the LIVE, still-typing what-if estimate (so the badge moves the
 * instant the debounced estimate returns) OR the committed custom price — and merges
 * the two before calling. `null` means the row has no custom candidate.
 *
 * Client-side by necessity: the custom price is client state (the seller is still
 * typing it), so the winner can only be resolved where that live choice lives. Every
 * figure it ranks (`currentNetProfit`, each band's `netProfit`, the custom estimate)
 * is already backend-computed — this does NO money math, only a strict ordering via
 * {@link compareFixedDecimal}.
 *
 * Only STRICTLY POSITIVE candidates enter the race ({@link isPositiveProfit}); "0.00"
 * and any loss are ineligible. Tie-breaking among the positive candidates preserves
 * the pre-existing behaviour, band > current > custom: the marker only MOVES off the
 * band when another option is STRICTLY more profitable, so a rounding-equal current or
 * custom price never steals the highlight from the band.
 */
export function resolveBestChoice(
  row: BestChoiceRow,
  customNetProfit: string | null,
): string | null {
  // Band candidate — the FIRST band holding the max profit (array order
  // band1..band4), matching the backend's `bestBandKey` (first max wins on ties).
  // Only strictly-profitable bands are eligible.
  let bestKey: string | null = null;
  let bestProfit: string | null = null;
  for (const band of row.bands) {
    if (band.netProfit === null || !isPositiveProfit(band.netProfit)) continue;
    if (bestProfit === null || compareFixedDecimal(band.netProfit, bestProfit) > 0) {
      bestKey = band.key;
      bestProfit = band.netProfit;
    }
  }

  // Current beats the band candidate only when STRICTLY greater (band wins ties);
  // eligible only when strictly profitable. When no band qualifies it becomes the
  // running best on its own.
  const current = row.currentNetProfit;
  if (
    current !== null &&
    isPositiveProfit(current) &&
    (bestProfit === null || compareFixedDecimal(current, bestProfit) > 0)
  ) {
    bestKey = 'current';
    bestProfit = current;
  }

  // Custom beats the running best (band + current) only when STRICTLY greater;
  // eligible only when strictly profitable.
  if (
    customNetProfit !== null &&
    isPositiveProfit(customNetProfit) &&
    (bestProfit === null || compareFixedDecimal(customNetProfit, bestProfit) > 0)
  ) {
    bestKey = 'custom';
    bestProfit = customNetProfit;
  }

  return bestKey;
}
