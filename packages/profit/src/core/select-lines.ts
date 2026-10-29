import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  type ProfitLineType,
} from '@pazarsync/db/enums';

import { type ProfitLine } from './profit-line';

/** A type's lines were produced at conflicting levels, so selecting them would mis-sum. */
export class ProfitLineLevelConflictError extends Error {}

/**
 * Which view of the lines to select:
 * - `BEST_KNOWN`: keep the highest-certainty line in every slot (estimates, user
 *   overrides, and marketplace/cargo actuals all compete).
 * - `ESTIMATE`: ignore marketplace and cargo-invoice actuals, so the result is the
 *   rule/seller estimate even after settlement has arrived.
 */
export type LineSelectionMode = 'BEST_KNOWN' | 'ESTIMATE';

/** Rank of a slot with no candidate line; any real rank beats it. */
const NO_RANK = 0;

// Higher rank wins within a slot: a user override beats an estimate, and an
// actual (marketplace record, cargo invoice or seller input) beats the override.
const CERTAINTY_RANK = {
  ESTIMATE: 1,
  USER_OVERRIDE: 2,
  ACTUAL: 3,
} as const satisfies Record<ProfitLineCertainty, number>;

interface TypeAggregate {
  parcelBest: number;
  readonly itemBest: Map<string, number>;
}

/** In ESTIMATE mode, marketplace and cargo-invoice actuals are not candidates. */
function isDroppedInEstimateMode(source: ProfitLineSource): boolean {
  return (
    source === ProfitLineSource.MARKETPLACE_RECORD || source === ProfitLineSource.CARGO_INVOICE
  );
}

/** Highest rank seen for a type across its parcel slot and every item slot. */
function overallBest(aggregate: TypeAggregate): number {
  let best = aggregate.parcelBest;
  for (const rank of aggregate.itemBest.values()) {
    if (rank > best) {
      best = rank;
    }
  }
  return best;
}

/**
 * Guards against a producer emitting one type at conflicting levels, which the
 * selection would silently mis-sum. Applied per type over the candidates that
 * remain after mode filtering.
 *
 * - Double count: the type survives at both the parcel and an item level while at
 *   least one survivor is not an actual (same-rank estimates/overrides on both
 *   levels would be added twice).
 * - Partial coverage: a non-actual parcel candidate sits next to an item actual, so
 *   the parcel estimate drops and items without an actual lose their share.
 */
function assertNoLevelConflict(
  type: ProfitLineType,
  candidates: readonly ProfitLine[],
  kept: ReadonlySet<ProfitLine>,
): void {
  let keptParcel = false;
  let keptItem = false;
  let keptNonActual = false;
  let candidateNonActualParcel = false;
  let candidateActualItem = false;

  for (const line of candidates) {
    if (line.type !== type) {
      continue;
    }
    const isActual = line.certainty === ProfitLineCertainty.ACTUAL;
    const isParcel = line.level === ProfitLineLevel.PARCEL;
    if (isParcel && !isActual) {
      candidateNonActualParcel = true;
    }
    if (!isParcel && isActual) {
      candidateActualItem = true;
    }
    if (kept.has(line)) {
      if (isParcel) {
        keptParcel = true;
      } else {
        keptItem = true;
      }
      if (!isActual) {
        keptNonActual = true;
      }
    }
  }

  if (keptParcel && keptItem && keptNonActual) {
    throw new ProfitLineLevelConflictError(
      `${type} keeps non-actual lines at both parcel and item level (double count)`,
    );
  }
  if (candidateNonActualParcel && candidateActualItem) {
    throw new ProfitLineLevelConflictError(
      `${type} mixes a parcel-level estimate with item-level actuals (partial coverage)`,
    );
  }
}

/**
 * The single selection rule. For each type it collapses competing lines so that
 * every slot keeps only its highest-certainty records, then returns the survivors
 * in the original input order.
 *
 * A type represents a single fee within a parcel, so it must be produced at one
 * level. A level conflict (an estimate or override at both levels, or a parcel
 * estimate alongside item actuals) is a producer bug and throws rather than
 * mis-summing; actual records at both levels are legitimate and are summed.
 */
export function selectLines(lines: readonly ProfitLine[], mode: LineSelectionMode): ProfitLine[] {
  const candidates =
    mode === 'ESTIMATE' ? lines.filter((line) => !isDroppedInEstimateMode(line.source)) : lines;

  const aggregates = new Map<ProfitLineType, TypeAggregate>();
  for (const line of candidates) {
    let aggregate = aggregates.get(line.type);
    if (aggregate === undefined) {
      aggregate = { parcelBest: NO_RANK, itemBest: new Map() };
      aggregates.set(line.type, aggregate);
    }
    const rank = CERTAINTY_RANK[line.certainty];
    if (line.level === ProfitLineLevel.PARCEL) {
      if (rank > aggregate.parcelBest) {
        aggregate.parcelBest = rank;
      }
    } else if (line.orderItemId !== null) {
      const current = aggregate.itemBest.get(line.orderItemId) ?? NO_RANK;
      if (rank > current) {
        aggregate.itemBest.set(line.orderItemId, rank);
      }
    }
  }

  const kept = new Set<ProfitLine>();
  for (const line of candidates) {
    const aggregate = aggregates.get(line.type);
    if (aggregate === undefined) {
      continue;
    }
    const rank = CERTAINTY_RANK[line.certainty];
    if (line.level === ProfitLineLevel.PARCEL) {
      if (rank === overallBest(aggregate)) {
        kept.add(line);
      }
      continue;
    }
    const itemBest =
      line.orderItemId !== null ? (aggregate.itemBest.get(line.orderItemId) ?? NO_RANK) : NO_RANK;
    if (rank === Math.max(aggregate.parcelBest, itemBest)) {
      kept.add(line);
    }
  }

  for (const type of aggregates.keys()) {
    assertNoLevelConflict(type, candidates, kept);
  }

  return lines.filter((line) => kept.has(line));
}
