import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { type Prisma } from '@pazarsync/db';
import {
  Platform,
  ProfitLineLevel,
  ProfitStatementView,
  type ProfitStatus,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';

import { allocateParcelLine } from '../core/allocation/allocate-parcel-line';
import { itemsForAllocation } from '../core/allocation/allocation-item-sets';
import { PROFIT_ENGINE_VERSION } from '../core/engine-version';
import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';
import { computeProfitStatement, type ProfitStatement } from '../core/profit-statement';
import { estimateTrendyolParcel } from '../marketplaces/trendyol/estimate-parcel';
import { mapTrendyolRecords } from '../marketplaces/trendyol/map-records';
import { type ContentHashAllocation, profitContentHash } from './content-hash';
import { ParcelNotFoundError, UnsupportedPlatformError } from './errors';
import { loadTrendyolParcel } from './load-trendyol-parcel';

/** The margin columns are numeric(12,4); round in the app, not in Postgres. */
const PERCENT_SCALE = 4;

/** Seed for the parcel advisory-lock hash; a fixed namespace shared by every parcel lock. */
const ADVISORY_LOCK_SEED = 0;

/** The best-known view's headline result, surfaced to the caller for logging/UI. */
export interface RecomputeParcelResult {
  readonly changed: boolean;
  readonly bestKnown: { readonly status: ProfitStatus; readonly netProfit: Decimal | null };
}

/**
 * Recomputes one parcel's profit and writes it in the caller's transaction. Takes a
 * parcel-scoped advisory lock first, so concurrent recomputes of the same order run
 * one at a time; the lock releases at commit or rollback. Then resolves the store's
 * platform, dispatches to the platform writer, and returns whether anything was
 * written along with the best-known status and net profit. Throws `ParcelNotFoundError`
 * when the order is not this organization's and `UnsupportedPlatformError` for a
 * platform without a writer yet.
 *
 * Caller contract:
 * - Runs inside the caller's transaction at READ COMMITTED (Postgres' default). Once
 *   the advisory lock is granted, a call that waited on it must see the committed
 *   statements of the call that held it; a stricter isolation level would hide them
 *   and defeat the content-hash no-op.
 * - The interactive-transaction timeout must cover a lock wait plus the parcel load;
 *   Prisma's 5s default may be too short, so pass an explicit `timeout`.
 */
export async function recomputeParcelProfit(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<RecomputeParcelResult> {
  const { organizationId, orderId } = params;

  // Serialize concurrent recomputes of the same parcel. $executeRaw, not $queryRaw:
  // the function returns void, which Prisma cannot deserialize. Released at commit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}, ${ADVISORY_LOCK_SEED}::int8))`;

  const order = await tx.order.findFirst({
    where: { id: orderId, organizationId },
    select: { store: { select: { platform: true } } },
  });
  if (order === null) {
    throw new ParcelNotFoundError(orderId);
  }

  const platform = order.store.platform;
  switch (platform) {
    case Platform.TRENDYOL:
      return recomputeTrendyolParcel(tx, params);
    case Platform.HEPSIBURADA:
      throw new UnsupportedPlatformError(platform);
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unhandled platform: ${_exhaustive}`);
    }
  }
}

/**
 * Loads a Trendyol parcel, drives it through the pure estimate + settlement mapper,
 * builds both statement views and the per-item allocations, and persists them unless
 * the stored content hash already matches. Kept apart from the dispatcher so a second
 * marketplace adds one switch case, not a rewrite of this function.
 */
async function recomputeTrendyolParcel(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly orderId: string },
): Promise<RecomputeParcelResult> {
  const { organizationId, orderId } = params;
  const loaded = await loadTrendyolParcel(tx, params);
  const snapshot = loaded.estimateInput.snapshot;

  const estimate = estimateTrendyolParcel(loaded.estimateInput);
  const mapped = mapTrendyolRecords({
    snapshot,
    attributes: loaded.estimateInput.attributes,
    fees: loaded.estimateInput.reference.fees,
    records: loaded.records,
    cargoItems: loaded.cargoItems,
    estimateLines: estimate.lines,
  });
  // mapped.periodRecords are not parcel lines: they stay in marketplace_finance_records
  // for the period writer in phase 3B and are not persisted here.

  const lines: ProfitLine[] = [...estimate.lines, ...mapped.lines];
  const issues: ProfitIssue[] = [...estimate.issues, ...mapped.issues, ...loaded.loadIssues];

  const statementCommon = {
    lines,
    settings: loaded.settings,
    isExportSale: snapshot.isExportSale,
    isCancelled: snapshot.isCancelled,
    isExcluded: loaded.isExcluded,
    issues,
  } as const;
  const estimateStatement = computeProfitStatement({
    ...statementCommon,
    view: ProfitStatementView.ESTIMATE,
  });
  const bestKnownStatement = computeProfitStatement({
    ...statementCommon,
    view: ProfitStatementView.BEST_KNOWN,
  });
  const statements = [estimateStatement, bestKnownStatement];
  const bestKnown = {
    status: bestKnownStatement.status,
    netProfit: bestKnownStatement.netProfit,
  };

  // Allocations for every parcel-level line (estimate and actual alike), kept with
  // the line's index so the hash and, later, the rows both find their parent line.
  const allocations: ContentHashAllocation[] = [];
  lines.forEach((line, index) => {
    if (line.level !== ProfitLineLevel.PARCEL) {
      return;
    }
    const shares = allocateParcelLine(line, itemsForAllocation(line.type, estimate.allocation));
    for (const share of shares) {
      allocations.push({ lineIndex: index, allocation: share });
    }
  });

  // The hash sees Decimal values at full precision, while the persisted columns are
  // rounded (percentages to 4, fxRate to 6, vatRatePct to 4). The hashed view is a
  // superset of the stored one, so a change that matters always flips the hash and a
  // needed write is never skipped; at worst two inputs that round to the same row
  // produce different hashes and an identical row is rewritten.
  const hash = profitContentHash({
    engineVersion: PROFIT_ENGINE_VERSION,
    settings: loaded.settings,
    lines,
    allocations,
    statements,
  });

  // No-op when both stored statement views already carry this exact content hash.
  const stored = await tx.orderProfitStatement.findMany({
    where: { orderId, organizationId },
    select: { view: true, contentHash: true },
  });
  const storedHashByView = new Map(stored.map((row) => [row.view, row.contentHash]));
  if (
    storedHashByView.get(ProfitStatementView.ESTIMATE) === hash &&
    storedHashByView.get(ProfitStatementView.BEST_KNOWN) === hash
  ) {
    return { changed: false, bestKnown };
  }

  await persistParcelProfit(tx, {
    organizationId: loaded.organizationId,
    storeId: loaded.storeId,
    orderId,
    settings: loaded.settings,
    lines,
    allocations,
    statements,
    hash,
  });

  return { changed: true, bestKnown };
}

/** A profit-line row built for createMany, carrying the id its allocations reference. */
interface ProfitLineRow {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly orderItemId: string | null;
  readonly type: ProfitLine['type'];
  readonly level: ProfitLine['level'];
  readonly certainty: ProfitLine['certainty'];
  readonly source: ProfitLine['source'];
  readonly amountGross: string;
  readonly amountVat: string;
  readonly vatRatePct: string | null;
  readonly originalCurrency: string;
  readonly originalGross: string;
  readonly originalVat: string;
  readonly fxRate: string;
  readonly fxRateDate: Date | null;
  readonly fxSource: ProfitLine['fx']['source'];
  readonly inputs: Prisma.InputJsonValue;
  readonly externalRecordId: string | null;
  readonly externalRecordType: string | null;
  readonly engineVersion: number;
}

/**
 * Deletes the parcel's existing lines (allocations cascade) and writes the fresh
 * lines, allocations and both statement rows. Rewrite-from-scratch instead of a
 * natural-key merge: the content hash gates whether we get here at all, and fresh
 * uuids never collide for two same-typed lines. Every row carries the order's
 * organization and store.
 */
async function persistParcelProfit(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly orderId: string;
    readonly settings: ResolvedProfitSettings;
    readonly lines: readonly ProfitLine[];
    readonly allocations: readonly ContentHashAllocation[];
    readonly statements: readonly ProfitStatement[];
    readonly hash: string;
  },
): Promise<void> {
  const { organizationId, storeId, orderId, settings, lines, allocations, statements, hash } =
    params;

  await tx.profitLine.deleteMany({ where: { orderId, organizationId } });

  const lineRows: ProfitLineRow[] = lines.map((line) => ({
    id: randomUUID(),
    organizationId,
    storeId,
    orderId,
    orderItemId: line.orderItemId,
    type: line.type,
    level: line.level,
    certainty: line.certainty,
    source: line.source,
    amountGross: line.amount.gross.toFixed(),
    amountVat: line.amount.vat.toFixed(),
    vatRatePct: line.vatRatePct === null ? null : line.vatRatePct.toFixed(),
    originalCurrency: line.fx.currency,
    originalGross: line.fx.original.gross.toFixed(),
    originalVat: line.fx.original.vat.toFixed(),
    fxRate: line.fx.rate.toFixed(),
    fxRateDate: line.fx.rateDate === null ? null : new Date(`${line.fx.rateDate}T00:00:00.000Z`),
    fxSource: line.fx.source,
    inputs: line.inputs,
    externalRecordId: line.externalRecord?.recordId ?? null,
    externalRecordType: line.externalRecord?.rawType ?? null,
    engineVersion: PROFIT_ENGINE_VERSION,
  }));
  await tx.profitLine.createMany({ data: lineRows });

  const allocationRows = allocations.map((entry) => {
    const parent = lineRows[entry.lineIndex];
    if (parent === undefined) {
      throw new Error(`allocation lineIndex ${entry.lineIndex.toString()} has no line`);
    }
    return {
      organizationId,
      storeId,
      profitLineId: parent.id,
      orderItemId: entry.allocation.orderItemId,
      amountGross: entry.allocation.amount.gross.toFixed(),
      amountVat: entry.allocation.amount.vat.toFixed(),
      basis: entry.allocation.basisUsed,
    };
  });
  if (allocationRows.length > 0) {
    await tx.profitLineAllocation.createMany({ data: allocationRows });
  }

  for (const statement of statements) {
    const columns = statementColumns({ statement, settings, hash });
    await tx.orderProfitStatement.upsert({
      where: { orderId_view: { orderId, view: statement.view } },
      create: { organizationId, storeId, orderId, view: statement.view, ...columns },
      update: columns,
    });
  }
}

/** A percent rounded to the column's 4 decimals, half-up; null passes through. */
function percentColumn(value: Decimal | null): string | null {
  return value === null
    ? null
    : value.toDecimalPlaces(PERCENT_SCALE, Decimal.ROUND_HALF_UP).toFixed();
}

/** The persisted shape of a single statement issue. */
function issuesJson(issues: readonly ProfitIssue[]): Prisma.InputJsonValue {
  return issues.map((issue) => ({
    code: issue.code,
    orderItemId: issue.orderItemId,
    detail: issue.detail,
  }));
}

/** The order_profit_statements columns shared by create and update for one view. */
function statementColumns(params: {
  readonly statement: ProfitStatement;
  readonly settings: ResolvedProfitSettings;
  readonly hash: string;
}): {
  readonly status: ProfitStatus;
  readonly saleGross: string;
  readonly costGross: string;
  readonly vatOutput: string;
  readonly vatInput: string;
  readonly vatNet: string;
  readonly vatEffective: string;
  readonly stoppageGross: string;
  readonly stoppageIncluded: boolean;
  readonly netProfit: string | null;
  readonly saleMarginPct: string | null;
  readonly costMarkupPct: string | null;
  readonly issues: Prisma.InputJsonValue;
  readonly settingsSnapshot: Prisma.InputJsonValue;
  readonly engineVersion: number;
  readonly contentHash: string;
  readonly computedAt: Date;
} {
  const { statement, settings, hash } = params;
  return {
    status: statement.status,
    saleGross: statement.saleGross.toFixed(),
    costGross: statement.costGross.toFixed(),
    vatOutput: statement.vat.output.toFixed(),
    vatInput: statement.vat.input.toFixed(),
    vatNet: statement.vat.net.toFixed(),
    vatEffective: statement.vat.effective.toFixed(),
    stoppageGross: statement.stoppageGross.toFixed(),
    stoppageIncluded: statement.stoppageIncluded,
    netProfit: statement.netProfit === null ? null : statement.netProfit.toFixed(),
    saleMarginPct: percentColumn(statement.saleMarginPct),
    costMarkupPct: percentColumn(statement.costMarkupPct),
    issues: issuesJson(statement.issues),
    // Snapshot the whole resolved settings object so a future setting is captured
    // without a second edit here; the content hash already covers every field.
    settingsSnapshot: { ...settings },
    engineVersion: PROFIT_ENGINE_VERSION,
    contentHash: hash,
    computedAt: new Date(),
  };
}
