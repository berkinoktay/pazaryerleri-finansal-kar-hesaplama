import {
  ProfitLineLevel,
  ProfitLineSource,
  type ProfitLineCertainty,
  type ProfitLineType,
} from '@pazarsync/db/enums';

import { type ProfitLine } from './profit-line';

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
 * The single selection rule. For each type it collapses competing lines so that
 * every slot keeps only its highest-certainty records, then returns the survivors
 * in the original input order.
 *
 * Resilient to level mismatch: a parcel-level actual supersedes item-level
 * estimates of the same type, so a correction never double-counts (plan-level
 * decision 5). Two actual records in the same slot are both kept so the caller
 * sums them (review focus 3).
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

  return lines.filter((line) => kept.has(line));
}
