import { Decimal } from 'decimal.js';

import { ceilToKurus, floorToKurus, ONE_KURUS } from '../../money';
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
 * Why the solver returned no price (ordered as the union below):
 * - NOT_COMPUTABLE: no segment produced a computable statement at all.
 * - NO_COST: a MARKUP target whose cost is zero (markup has no base).
 * - UNREACHABLE_TARGET: price-sensitive, but the target lies outside every band.
 * - NOT_PRICE_SENSITIVE: raising the price does not raise net profit.
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

/**
 * The most one profit line can move the net profit through rounding: its gross and
 * its VAT each round by at most half a kurus, so one kurus in total. A segment's
 * noise bound is this times the line count, and it sizes the scan window below.
 */
export const SCENARIO_LINE_ROUNDING_BOUND = new Decimal('0.01');

/** Upper bound on the kurus a single scan walks, so no loop is ever unbounded. */
export const SCENARIO_MAX_SCAN_STEPS = 600;

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);
const KURUS_FRACTION_DIGITS = 2;

/** A band at most this many kurus wide is scanned point by point rather than solved. */
const TINY_SEGMENT_MAX_STEPS = 6;
const TINY_SEGMENT_WIDTH = ONE_KURUS.mul(TINY_SEGMENT_MAX_STEPS);

/** A half-open price band processed as one unit; `end === null` is unbounded above. */
interface Segment {
  readonly start: Decimal;
  readonly end: Decimal | null;
}

/** A price band with a known upper bound, for the tiny point-by-point scan. */
interface BoundedSegment {
  readonly start: Decimal;
  readonly end: Decimal;
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

/** A found price and the statement that justifies it. */
interface PricePoint {
  readonly unitPrice: Decimal;
  readonly statement: ProfitStatement;
}

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

function pointOutcome(point: PricePoint | null): SegmentOutcome {
  return point === null
    ? EMPTY_OUTCOME
    : { kind: 'candidate', unitPrice: point.unitPrice, statement: point.statement };
}

/**
 * The target gap g(P): `g >= 0` means the target is met at that price. Within a
 * band g is linear in price up to per-line rounding noise, which the closed form
 * below exploits and the scan window corrects for.
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
    const end = breakpoint.sub(ONE_KURUS);
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

/** The rounding noise on net profit for a segment: one kurus per line, at its busiest sample. */
function segmentNoiseBound(a: ComputableSample, b: ComputableSample): Decimal {
  const maxLines = Math.max(a.statement.selectedLines.length, b.statement.selectedLines.length);
  return SCENARIO_LINE_ROUNDING_BOUND.mul(maxLines);
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
    lower: { start: segment.start, end: splitPoint.sub(ONE_KURUS) },
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
 * The closed-form candidate assuming the gap is exactly linear in price:
 * - positive slope: `ceil(-intercept / slope)`, never below the band start (the
 *   band-end clamp and the rounding-noise window are applied by the caller);
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
    return Decimal.max(segment.start, raw);
  }
  if (gapAtStart.lt(ZERO)) {
    return null;
  }
  return segment.start;
}

/**
 * Scans upward from `from`, one kurus at a time, up to `maxSteps` kurus and never
 * past `maxPrice` (null = open), returning the first price whose gap holds.
 */
function scanUpForFirst(
  state: SolveState,
  from: Decimal,
  maxPrice: Decimal | null,
  maxSteps: number,
): PricePoint | null {
  let price = from;
  for (let step = 0; step <= maxSteps; step++) {
    if (maxPrice !== null && price.gt(maxPrice)) {
      return null;
    }
    const sample = evaluateAt(state, price);
    if (sample.computable && sample.gap.gte(ZERO)) {
      return { unitPrice: price, statement: sample.statement };
    }
    price = price.add(ONE_KURUS);
  }
  return null;
}

/**
 * Turns a closed-form candidate into the lowest meeting price, correcting for
 * per-line rounding noise. The gap is a line plus noise bounded by `noiseBound`, so
 * the true solution sits within `3 * noiseBound / slope` kurus of the candidate.
 * For a positive slope the solver scans that window for the lowest meeting price
 * rather than nudging a fixed distance; below the window the gap is guaranteed
 * negative, so the first meeting price found scanning upward is the lowest. A
 * non-positive slope keeps the band-start rule.
 *
 * When the window is wider than `SCENARIO_MAX_SCAN_STEPS` kurus -- only for a target
 * a hair below the margin asymptote, reached at very high prices -- the solver
 * approximates: the closed form already lands within a few kurus of the answer (the
 * `3 * noiseBound / slope` width is a conservative bound, not the actual error), so
 * it scans a budget-sized window centred on the candidate. Should that scan miss
 * (the candidate off by more than half the budget, i.e. model error beyond the
 * rounding noise), `upper = ceil(candidate + 3 * noiseBound / slope)` is a safety
 * net: when it was not clamped to the band end the noise bound guarantees the true
 * solution sits at or below it, so if it meets the target it is returned -- a valid
 * price, though not necessarily the lowest.
 */
function resolveCandidate(
  state: SolveState,
  segment: Segment,
  candidate: Decimal,
  gapSlope: Decimal,
  noiseBound: Decimal,
): SegmentOutcome {
  if (gapSlope.lte(ZERO)) {
    const sample = evaluateAt(state, candidate);
    if (sample.computable && sample.gap.gte(ZERO)) {
      return { kind: 'candidate', unitPrice: candidate, statement: sample.statement };
    }
    return EMPTY_OUTCOME;
  }

  const half = noiseBound.mul(3).div(gapSlope);
  const lower = Decimal.max(segment.start, floorToKurus(candidate.sub(half)));
  const rawUpper = ceilToKurus(candidate.add(half));
  const upper = segment.end !== null && rawUpper.gt(segment.end) ? segment.end : rawUpper;
  if (lower.gt(upper)) {
    return EMPTY_OUTCOME;
  }

  if (upper.sub(lower).div(ONE_KURUS).lte(SCENARIO_MAX_SCAN_STEPS)) {
    return pointOutcome(scanUpForFirst(state, lower, upper, SCENARIO_MAX_SCAN_STEPS));
  }

  const halfBudget = ONE_KURUS.mul(Math.floor(SCENARIO_MAX_SCAN_STEPS / 2));
  const scanStart = Decimal.max(lower, floorToKurus(candidate.sub(halfBudget)));
  const found = scanUpForFirst(state, scanStart, upper, SCENARIO_MAX_SCAN_STEPS);
  if (found !== null) {
    return pointOutcome(found);
  }

  const top = evaluateAt(state, upper);
  if (top.computable && top.gap.gte(ZERO)) {
    return { kind: 'candidate', unitPrice: upper, statement: top.statement };
  }
  return EMPTY_OUTCOME;
}

/** Scans a band narrower than the solve window kurus by kurus, returning the first meeting price. */
function scanTinySegment(state: SolveState, segment: BoundedSegment): SegmentOutcome {
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
    price = price.add(ONE_KURUS);
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
 * solves the closed form and resolves the candidate against rounding noise.
 * Returns a candidate, a NO_COST short-circuit, or `empty` (recording
 * computability and slope in state).
 */
function processSegment(
  state: SolveState,
  segment: Segment,
  parentLimit: Decimal | null,
): SegmentOutcome {
  if (segment.end !== null && segment.end.sub(segment.start).lt(TINY_SEGMENT_WIDTH)) {
    return scanTinySegment(state, { start: segment.start, end: segment.end });
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
  // A computable start already makes this band computable, even if the far sample is not.
  state.anyComputable = true;
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

  return resolveCandidate(state, segment, candidate, gapSlope, segmentNoiseBound(s1, s2));
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
  return resolveCandidate(state, segment, recomputed, gapSlope, segmentNoiseBound(s1, s3));
}

/**
 * Finds the lowest unit price that meets `target`, or the reason none does. The
 * price axis is split into bands at `breakpoints` (where the shipping or
 * commission regime changes) plus the net VAT kink the solver finds itself; each
 * band is solved in closed form from two samples and the candidate is resolved
 * against per-line rounding noise with a bounded kurus scan -- no binary search.
 * Every loop is bounded by the band count, the scan budget, or a tiny band's width.
 */
export function solveScenarioPrice(params: {
  readonly evaluate: (unitPrice: Decimal) => ProfitStatement;
  readonly breakpoints: readonly Decimal[];
  readonly target: ScenarioPriceTarget;
  readonly minUnitPrice: Decimal;
  readonly maxUnitPrice: Decimal | null;
}): ScenarioSolveResult {
  if (params.minUnitPrice.lt(ONE_KURUS)) {
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
