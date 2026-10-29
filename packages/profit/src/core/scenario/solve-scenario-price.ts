import { Decimal } from 'decimal.js';

import { ceilToKurus } from '../../money';
import { type ProfitStatement } from '../profit-statement';

/**
 * What the solver drives the unit price towards. Ratios are percentages
 * (e.g. 20 = 20%): MARGIN is netProfit over saleGross, MARKUP is netProfit over
 * costGross, PROFIT is an absolute net profit amount.
 */
export type ScenarioPriceTarget =
  | { readonly kind: 'MARGIN'; readonly pct: Decimal }
  | { readonly kind: 'MARKUP'; readonly pct: Decimal }
  | { readonly kind: 'PROFIT'; readonly amount: Decimal };

/**
 * Why the solver returned no price:
 * - NOT_COMPUTABLE: no segment produced a computable statement at all.
 * - NO_COST: a MARKUP target whose cost is zero (markup has no base).
 * - NOT_PRICE_SENSITIVE: raising the price does not raise net profit.
 * - UNREACHABLE_TARGET: price-sensitive, but the target lies outside every band.
 */
export type ScenarioSolveFailure =
  | 'NOT_COMPUTABLE'
  | 'NO_COST'
  | 'UNREACHABLE_TARGET'
  | 'NOT_PRICE_SENSITIVE';

/** The lowest unit price that meets the target, or the reason none does. */
export type ScenarioSolveResult =
  | { readonly ok: true; readonly unitPrice: Decimal; readonly statement: ProfitStatement }
  | { readonly ok: false; readonly reason: ScenarioSolveFailure };

/** Second sample of an open-ended segment: its start plus this span. */
export const SCENARIO_SAMPLE_SPAN = new Decimal('1000.00');

/** How many kurus the solver nudges a candidate up or down while verifying it. */
export const SCENARIO_MAX_NUDGE_STEPS = 3;

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);
const KURUS = new Decimal('0.01');
const KURUS_FRACTION_DIGITS = 2;

/** Segments this narrow (in price) are scanned kurus by kurus instead of solved. */
const TINY_SEGMENT_WIDTH = KURUS.mul(SCENARIO_MAX_NUDGE_STEPS * 2);

/** A half-open price band processed as one unit; `end === null` is unbounded above. */
interface Segment {
  readonly start: Decimal;
  readonly end: Decimal | null;
}

/**
 * One evaluated price. A statement whose status is NOT_COMPUTABLE (netProfit null)
 * yields `{ computable: false }`; otherwise the net profit and the pre-computed
 * target gap travel with it.
 */
type Sample =
  | { readonly computable: false }
  | {
      readonly computable: true;
      readonly statement: ProfitStatement;
      readonly netProfit: Decimal;
      readonly gap: Decimal;
    };

type ComputableSample = Extract<Sample, { readonly computable: true }>;

/** Mutable bookkeeping shared across the whole solve for a single call. */
interface SolveState {
  readonly evaluate: (unitPrice: Decimal) => ProfitStatement;
  readonly target: ScenarioPriceTarget;
  readonly memo: Map<string, Sample>;
  noCost: boolean;
  anyComputable: boolean;
  highestSlope: Decimal | null; // netProfit slope of the highest computable segment
}

type SegmentOutcome =
  | { readonly kind: 'candidate'; readonly unitPrice: Decimal; readonly statement: ProfitStatement }
  | { readonly kind: 'no_cost' }
  | { readonly kind: 'empty' };

const EMPTY_OUTCOME: SegmentOutcome = { kind: 'empty' };
const NO_COST_OUTCOME: SegmentOutcome = { kind: 'no_cost' };

/**
 * The target gap g(P): `g >= 0` means the target is met at that price. Within a
 * band g is linear in price, which is what the closed form below exploits.
 */
function computeGap(
  target: ScenarioPriceTarget,
  netProfit: Decimal,
  saleGross: Decimal,
  costGross: Decimal,
): Decimal {
  switch (target.kind) {
    case 'PROFIT':
      return netProfit.sub(target.amount);
    case 'MARGIN':
      return netProfit.sub(target.pct.div(HUNDRED).mul(saleGross));
    case 'MARKUP':
      return netProfit.sub(target.pct.div(HUNDRED).mul(costGross));
    default: {
      const _exhaustive: never = target;
      throw new Error(`Unhandled scenario target: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Evaluates one price, memoised by kurus, and classifies it into a `Sample`. */
function evaluateAt(state: SolveState, unitPrice: Decimal): Sample {
  const key = unitPrice.toFixed(KURUS_FRACTION_DIGITS);
  const cached = state.memo.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const statement = state.evaluate(unitPrice);
  const netProfit = statement.netProfit;
  let sample: Sample;
  if (netProfit === null) {
    sample = { computable: false };
  } else {
    if (state.target.kind === 'MARKUP' && statement.costGross.isZero()) {
      state.noCost = true;
    }
    sample = {
      computable: true,
      statement,
      netProfit,
      gap: computeGap(state.target, netProfit, statement.saleGross, statement.costGross),
    };
  }
  state.memo.set(key, sample);
  return sample;
}

/**
 * Splits the price axis at the breakpoints that fall strictly above
 * `minUnitPrice` and (when bounded) at or below `maxUnitPrice`. A band runs from
 * one breakpoint to one kurus below the next; the last band ends at
 * `maxUnitPrice` or stays open-ended.
 */
function buildSegments(
  breakpoints: readonly Decimal[],
  minUnitPrice: Decimal,
  maxUnitPrice: Decimal | null,
): Segment[] {
  const sorted = [...breakpoints].sort((a, b) => a.comparedTo(b));
  const kept: Decimal[] = [];
  let lastKept: Decimal | null = null;
  for (const breakpoint of sorted) {
    if (breakpoint.lte(minUnitPrice)) {
      continue;
    }
    if (maxUnitPrice !== null && breakpoint.gt(maxUnitPrice)) {
      continue;
    }
    if (lastKept !== null && lastKept.equals(breakpoint)) {
      continue;
    }
    kept.push(breakpoint);
    lastKept = breakpoint;
  }

  const segments: Segment[] = [];
  let start = minUnitPrice;
  for (const breakpoint of kept) {
    const end = breakpoint.sub(KURUS);
    if (end.gte(start)) {
      segments.push({ start, end });
    }
    start = breakpoint;
  }
  if (maxUnitPrice === null || maxUnitPrice.gte(start)) {
    segments.push({ start, end: maxUnitPrice });
  }
  return segments;
}

/** A band's size for the recursion guard; open-ended bands count as the sample span. */
function spanOf(segment: Segment): Decimal {
  return segment.end === null ? SCENARIO_SAMPLE_SPAN : segment.end.sub(segment.start);
}

/**
 * A net VAT kink exists when net VAT changes sign across the two samples and, at
 * the negative sample, the store clamps it (effective net VAT differs from the
 * raw net VAT). The clamp bends the otherwise-linear profit curve, so the band
 * must be split at the crossing.
 */
function hasNetVatKink(s1: ComputableSample, s2: ComputableSample): boolean {
  const net1 = s1.statement.vat.net;
  const net2 = s2.statement.vat.net;
  const opposite = (net1.lt(ZERO) && net2.gt(ZERO)) || (net1.gt(ZERO) && net2.lt(ZERO));
  if (!opposite) {
    return false;
  }
  const negative = net1.lt(ZERO) ? s1 : s2;
  return !negative.statement.vat.effective.equals(negative.statement.vat.net);
}

/** Linear net-VAT zero crossing between the two samples, rounded up to a kurus. */
function netVatSplitPoint(
  p1: Decimal,
  s1: ComputableSample,
  p2: Decimal,
  s2: ComputableSample,
): Decimal {
  const net1 = s1.statement.vat.net;
  const net2 = s2.statement.vat.net;
  const crossing = p1.add(net1.negated().mul(p2.sub(p1)).div(net2.sub(net1)));
  return ceilToKurus(crossing);
}

/** Lower `[start, split - 0.01]` and upper `[split, end]` bands, or null when degenerate. */
function splitSegment(
  segment: Segment,
  splitPoint: Decimal,
): { lower: Segment; upper: Segment } | null {
  if (splitPoint.lte(segment.start)) {
    return null;
  }
  if (segment.end !== null && splitPoint.gt(segment.end)) {
    return null;
  }
  return {
    lower: { start: segment.start, end: splitPoint.sub(KURUS) },
    upper: { start: splitPoint, end: segment.end },
  };
}

/** Both halves must be strictly smaller than the parent band to bound the recursion. */
function splitAllowed(lower: Segment, upper: Segment, parentLimit: Decimal | null): boolean {
  if (parentLimit === null) {
    return true;
  }
  return spanOf(lower).lt(parentLimit) && spanOf(upper).lt(parentLimit);
}

/**
 * The lowest kurus where the gap closes, assuming the gap is linear in price:
 * - positive slope: `ceil(-intercept / slope)`, clamped to the band start, and
 *   rejected when it overshoots a bounded band;
 * - non-positive slope: only the band start can meet the target, and only if the
 *   gap already holds there.
 */
function closedFormCandidate(
  segment: Segment,
  gapAtStart: Decimal,
  gapSlope: Decimal,
): Decimal | null {
  if (gapSlope.gt(ZERO)) {
    const intercept = gapAtStart.sub(gapSlope.mul(segment.start));
    const raw = ceilToKurus(intercept.negated().div(gapSlope));
    const candidate = Decimal.max(segment.start, raw);
    if (segment.end !== null && candidate.gt(segment.end)) {
      return null;
    }
    return candidate;
  }
  if (gapAtStart.lt(ZERO)) {
    return null;
  }
  return segment.start;
}

/** Nudges up to `SCENARIO_MAX_NUDGE_STEPS` kurus until the gap first holds, within the band. */
function nudgeUp(
  state: SolveState,
  segment: Segment,
  candidate: Decimal,
): { unitPrice: Decimal; statement: ProfitStatement } | null {
  let price = candidate;
  for (let step = 0; step < SCENARIO_MAX_NUDGE_STEPS; step++) {
    price = price.add(KURUS);
    if (segment.end !== null && price.gt(segment.end)) {
      return null;
    }
    const sample = evaluateAt(state, price);
    if (sample.computable && sample.gap.gte(ZERO)) {
      return { unitPrice: price, statement: sample.statement };
    }
  }
  return null;
}

/** Keeps the lowest kurus (within `SCENARIO_MAX_NUDGE_STEPS` and the band) where the gap still holds. */
function nudgeDown(
  state: SolveState,
  segment: Segment,
  candidate: Decimal,
  candidateStatement: ProfitStatement,
): { unitPrice: Decimal; statement: ProfitStatement } {
  let bestPrice = candidate;
  let bestStatement = candidateStatement;
  for (let step = 0; step < SCENARIO_MAX_NUDGE_STEPS; step++) {
    const lower = bestPrice.sub(KURUS);
    if (lower.lt(segment.start)) {
      break;
    }
    const sample = evaluateAt(state, lower);
    if (!sample.computable || sample.gap.lt(ZERO)) {
      break;
    }
    bestPrice = lower;
    bestStatement = sample.statement;
  }
  return { unitPrice: bestPrice, statement: bestStatement };
}

/** Evaluates the candidate, then nudges up (gap short) or down (gap holds) to the lowest meeting kurus. */
function verifyAndNudge(
  state: SolveState,
  segment: Segment,
  candidate: Decimal,
): { unitPrice: Decimal; statement: ProfitStatement } | null {
  const sample = evaluateAt(state, candidate);
  if (!sample.computable) {
    return null;
  }
  if (sample.gap.lt(ZERO)) {
    return nudgeUp(state, segment, candidate);
  }
  return nudgeDown(state, segment, candidate, sample.statement);
}

/** Scans a band narrower than the nudge window kurus by kurus, returning the first meeting price. */
function scanTinySegment(state: SolveState, segment: Segment): SegmentOutcome {
  if (segment.end === null) {
    return EMPTY_OUTCOME;
  }
  let firstPoint: { price: Decimal; netProfit: Decimal } | null = null;
  let lastPoint: { price: Decimal; netProfit: Decimal } | null = null;
  let price = segment.start;
  while (price.lte(segment.end)) {
    const sample = evaluateAt(state, price);
    if (state.noCost) {
      return NO_COST_OUTCOME;
    }
    if (sample.computable) {
      state.anyComputable = true;
      const point = { price, netProfit: sample.netProfit };
      firstPoint = firstPoint ?? point;
      lastPoint = point;
      if (sample.gap.gte(ZERO)) {
        return { kind: 'candidate', unitPrice: price, statement: sample.statement };
      }
    }
    price = price.add(KURUS);
  }
  if (firstPoint !== null && lastPoint !== null && !firstPoint.price.equals(lastPoint.price)) {
    state.highestSlope = lastPoint.netProfit
      .sub(firstPoint.netProfit)
      .div(lastPoint.price.sub(firstPoint.price));
  }
  return EMPTY_OUTCOME;
}

/**
 * Processes one band: samples its two ends, splits once at a net VAT kink, then
 * solves the closed form and verifies the candidate. Returns a candidate, a
 * NO_COST short-circuit, or `empty` (recording computability and slope in state).
 */
function processSegment(
  state: SolveState,
  segment: Segment,
  parentLimit: Decimal | null,
): SegmentOutcome {
  if (segment.end !== null && segment.end.sub(segment.start).lt(TINY_SEGMENT_WIDTH)) {
    return scanTinySegment(state, segment);
  }

  const p1 = segment.start;
  const p2 = segment.end === null ? segment.start.add(SCENARIO_SAMPLE_SPAN) : segment.end;

  const s1 = evaluateAt(state, p1);
  if (state.noCost) {
    return NO_COST_OUTCOME;
  }
  if (!s1.computable) {
    return EMPTY_OUTCOME;
  }
  const s2 = evaluateAt(state, p2);
  if (state.noCost) {
    return NO_COST_OUTCOME;
  }
  if (!s2.computable) {
    return EMPTY_OUTCOME;
  }

  if (hasNetVatKink(s1, s2)) {
    const split = splitSegment(segment, netVatSplitPoint(p1, s1, p2, s2));
    if (split !== null && splitAllowed(split.lower, split.upper, parentLimit)) {
      const childLimit = spanOf(segment);
      const lower = processSegment(state, split.lower, childLimit);
      if (lower.kind !== 'empty') {
        return lower;
      }
      return processSegment(state, split.upper, childLimit);
    }
  }

  state.anyComputable = true;
  const priceSpan = p2.sub(p1);
  state.highestSlope = s2.netProfit.sub(s1.netProfit).div(priceSpan);

  const gapSlope = s2.gap.sub(s1.gap).div(priceSpan);
  const candidate = closedFormCandidate(segment, s1.gap, gapSlope);
  if (candidate === null) {
    return EMPTY_OUTCOME;
  }

  // An open segment's candidate can extrapolate past the second sample, over a net
  // VAT kink that sits beyond it. Both samples would then be on the clamped side,
  // so the kink stays hidden and the clamped slope overshoots. Re-sample once at
  // the candidate to expose that kink (or confirm its absence).
  if (segment.end === null && candidate.gt(p2)) {
    return resolveBeyondSecondSample(state, segment, parentLimit, p1, s1, candidate);
  }

  return candidateOutcome(state, segment, candidate);
}

/** Turns a closed-form candidate into an outcome via `verifyAndNudge`. */
function candidateOutcome(state: SolveState, segment: Segment, candidate: Decimal): SegmentOutcome {
  const found = verifyAndNudge(state, segment, candidate);
  if (found === null) {
    return EMPTY_OUTCOME;
  }
  return { kind: 'candidate', unitPrice: found.unitPrice, statement: found.statement };
}

/**
 * Handles an open segment whose closed-form candidate extrapolated past the
 * second sample. Re-samples once at the candidate: if that reveals a net VAT kink
 * it splits there (bounded lower half, open upper half); otherwise it recomputes
 * the closed form from the start sample and this farther sample. Called at most
 * once per segment, so no new unbounded loop is introduced.
 */
function resolveBeyondSecondSample(
  state: SolveState,
  segment: Segment,
  parentLimit: Decimal | null,
  p1: Decimal,
  s1: ComputableSample,
  candidate: Decimal,
): SegmentOutcome {
  const s3 = evaluateAt(state, candidate);
  if (state.noCost) {
    return NO_COST_OUTCOME;
  }
  if (!s3.computable) {
    return EMPTY_OUTCOME;
  }

  if (hasNetVatKink(s1, s3)) {
    const split = splitSegment(segment, netVatSplitPoint(p1, s1, candidate, s3));
    if (split !== null && splitAllowed(split.lower, split.upper, parentLimit)) {
      const childLimit = spanOf(segment);
      const lower = processSegment(state, split.lower, childLimit);
      if (lower.kind !== 'empty') {
        return lower;
      }
      return processSegment(state, split.upper, childLimit);
    }
  }

  const priceSpan = candidate.sub(p1);
  state.highestSlope = s3.netProfit.sub(s1.netProfit).div(priceSpan);
  const gapSlope = s3.gap.sub(s1.gap).div(priceSpan);
  const recomputed = closedFormCandidate(segment, s1.gap, gapSlope);
  if (recomputed === null) {
    return EMPTY_OUTCOME;
  }
  return candidateOutcome(state, segment, recomputed);
}

/**
 * Finds the lowest unit price that meets `target`, or the reason none does. The
 * price axis is split into bands at `breakpoints` (where the shipping or
 * commission regime changes) plus the net VAT kink the solver finds itself; each
 * band is solved in closed form from two samples and verified with a bounded
 * kurus nudge. No binary search, no unbounded loops: every loop is bounded by the
 * band count, the nudge steps, or a tiny band's width.
 */
export function solveScenarioPrice(params: {
  readonly evaluate: (unitPrice: Decimal) => ProfitStatement;
  readonly breakpoints: readonly Decimal[];
  readonly target: ScenarioPriceTarget;
  readonly minUnitPrice: Decimal;
  readonly maxUnitPrice: Decimal | null;
}): ScenarioSolveResult {
  if (params.minUnitPrice.lt(KURUS)) {
    throw new RangeError('minUnitPrice must be at least 0.01');
  }
  if (params.maxUnitPrice !== null && params.maxUnitPrice.lt(params.minUnitPrice)) {
    throw new RangeError('maxUnitPrice must be at least minUnitPrice');
  }

  const state: SolveState = {
    evaluate: params.evaluate,
    target: params.target,
    memo: new Map(),
    noCost: false,
    anyComputable: false,
    highestSlope: null,
  };

  const segments = buildSegments(params.breakpoints, params.minUnitPrice, params.maxUnitPrice);
  for (const segment of segments) {
    const outcome = processSegment(state, segment, null);
    switch (outcome.kind) {
      case 'candidate':
        return { ok: true, unitPrice: outcome.unitPrice, statement: outcome.statement };
      case 'no_cost':
        return { ok: false, reason: 'NO_COST' };
      case 'empty':
        break;
      default: {
        const _exhaustive: never = outcome;
        throw new Error(`Unhandled segment outcome: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  if (!state.anyComputable) {
    return { ok: false, reason: 'NOT_COMPUTABLE' };
  }
  if (state.highestSlope !== null && state.highestSlope.lte(ZERO)) {
    return { ok: false, reason: 'NOT_PRICE_SENSITIVE' };
  }
  return { ok: false, reason: 'UNREACHABLE_TARGET' };
}
