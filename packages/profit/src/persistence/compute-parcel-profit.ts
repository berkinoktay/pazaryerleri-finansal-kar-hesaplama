import { type Prisma } from '@pazarsync/db';
import { Platform, ProfitLineLevel, ProfitStatementView } from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';

import { allocateParcelLine } from '../core/allocation/allocate-parcel-line';
import { itemsForAllocation } from '../core/allocation/allocation-item-sets';
import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';
import { computeProfitStatement, type ProfitStatement } from '../core/profit-statement';
import { estimateTrendyolParcel } from '../marketplaces/trendyol/estimate-parcel';
import { mapTrendyolRecords } from '../marketplaces/trendyol/map-records';
import { type ContentHashAllocation } from './content-hash';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';
import { loadTrendyolParcel } from './load-trendyol-parcel';

/**
 * Everything a parcel recompute produces, before anything is persisted: the resolved
 * settings, the profit lines with their per-item allocations, and both statement
 * views. The writer turns this into rows; a request-time reader uses it directly
 * without ever writing. No advisory lock is involved and nothing is written.
 */
export interface ComputedParcelProfit {
  readonly organizationId: string;
  readonly storeId: string;
  readonly settings: ResolvedProfitSettings;
  readonly lines: readonly ProfitLine[];
  readonly allocations: readonly ContentHashAllocation[];
  readonly estimate: ProfitStatement;
  readonly bestKnown: ProfitStatement;
}

/** Computes one parcel's profit for a single marketplace, read-only, in the caller's transaction. */
type ParcelProfitComputer = (
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
) => Promise<ComputedParcelProfit>;

/**
 * The one registry of per-platform profit computers. A `null` entry means the engine
 * cannot compute that platform yet: `computeParcelProfit` throws
 * `UnsupportedPlatformError`, the queue drain deletes its marks (UNSUPPORTED_PLATFORM)
 * and the stale sweep skips its orders. Registering a computer here is all it takes to
 * make the writer, the request-time reader and the sweep pick those orders up by
 * themselves. A new Platform enum value without an entry is a compile error, because
 * the map is a Record over Platform.
 */
export const PARCEL_PROFIT_COMPUTERS: Readonly<Record<Platform, ParcelProfitComputer | null>> = {
  [Platform.TRENDYOL]: computeTrendyolParcelProfit,
  [Platform.HEPSIBURADA]: null,
};

/**
 * Computes one parcel's profit and returns it without taking any lock or writing
 * anything. Resolves the store's platform, looks its computer up in the
 * PARCEL_PROFIT_COMPUTERS registry, and runs it. Throws `ParcelNotFoundError` when the
 * order is not this organization's and `UnsupportedPlatformError` for a platform whose
 * registry entry is null -- the same errors the writer throws today. Read-only, so it
 * suits a request that needs a parcel's profit before its statement row exists.
 */
export async function computeParcelProfit(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<ComputedParcelProfit> {
  const { organizationId, orderId } = params;

  const order = await tx.order.findFirst({
    where: { id: orderId, organizationId },
    select: { store: { select: { platform: true } } },
  });
  if (order === null) {
    throw new ParcelNotFoundError(orderId);
  }

  const platform = order.store.platform;
  const computer = PARCEL_PROFIT_COMPUTERS[platform];
  if (computer === null) {
    throw new UnsupportedPlatformError(platform);
  }
  return computer(tx, params);
}

/**
 * Loads a Trendyol parcel, drives it through the pure estimate + settlement mapper,
 * and builds both statement views and the per-item allocations -- read-only. Kept
 * apart from the dispatcher so a second marketplace registers one computer, not a
 * rewrite of this function.
 */
async function computeTrendyolParcelProfit(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<ComputedParcelProfit> {
  const loaded = await loadTrendyolParcel(tx, params);
  const snapshot = loaded.estimateInput.snapshot;

  const estimateResult = estimateTrendyolParcel(loaded.estimateInput);
  const mapped = mapTrendyolRecords({
    snapshot,
    attributes: loaded.estimateInput.attributes,
    fees: loaded.estimateInput.reference.fees,
    records: loaded.records,
    cargoItems: loaded.cargoItems,
    estimateLines: estimateResult.lines,
  });
  // mapped.periodRecords are not parcel lines: they stay in marketplace_finance_records
  // for the period writer in phase 3B and are not persisted here.

  const lines: ProfitLine[] = [...estimateResult.lines, ...mapped.lines];
  const issues: ProfitIssue[] = [...estimateResult.issues, ...mapped.issues, ...loaded.loadIssues];

  const statementCommon = {
    lines,
    settings: loaded.settings,
    isExportSale: snapshot.isExportSale,
    isCancelled: snapshot.isCancelled,
    isExcluded: loaded.isExcluded,
    issues,
  } as const;
  const estimate = computeProfitStatement({
    ...statementCommon,
    view: ProfitStatementView.ESTIMATE,
  });
  const bestKnown = computeProfitStatement({
    ...statementCommon,
    view: ProfitStatementView.BEST_KNOWN,
  });

  // Allocations for every parcel-level line (estimate and actual alike), kept with
  // the line's index so the hash and, later, the rows both find their parent line.
  const allocations: ContentHashAllocation[] = [];
  lines.forEach((line, index) => {
    if (line.level !== ProfitLineLevel.PARCEL) {
      return;
    }
    const shares = allocateParcelLine(
      line,
      itemsForAllocation(line.type, estimateResult.allocation),
    );
    for (const share of shares) {
      allocations.push({ lineIndex: index, allocation: share });
    }
  });

  return {
    organizationId: loaded.organizationId,
    storeId: loaded.storeId,
    settings: loaded.settings,
    lines,
    allocations,
    estimate,
    bestKnown,
  };
}
