import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { type Prisma } from '@pazarsync/db';
import {
  Platform,
  ProfitStatementView,
  type ProfitStatus,
  type ReconciliationStatus,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';

import { PROFIT_ENGINE_VERSION } from '../core/engine-version';
import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';
import { type ProfitStatement } from '../core/profit-statement';
import { roundPercent } from '../money';
import { computeParcelProfit, PARCEL_PROFIT_COMPUTERS } from './compute-parcel-profit';
import { type ContentHashAllocation, profitContentHash } from './content-hash';
import { captureOrderProfitSnapshot } from './order-profit-snapshot';

/** Seed for the parcel advisory-lock hash; a fixed namespace shared by every parcel lock. */
const ADVISORY_LOCK_SEED = 0;

/** The best-known view's headline result, surfaced to the caller for logging/UI. */
export interface RecomputeParcelResult {
  readonly changed: boolean;
  readonly bestKnown: { readonly status: ProfitStatus; readonly netProfit: Decimal | null };
}

/**
 * The platforms the engine can compute: those with a computer registered in the
 * PARCEL_PROFIT_COMPUTERS registry. Exported from here so the queue drain and the
 * stale sweep keep importing it unchanged.
 */
export const PROFIT_ENGINE_PLATFORMS: readonly Platform[] = Object.values(Platform).filter(
  (platform) => PARCEL_PROFIT_COMPUTERS[platform] !== null,
);

/**
 * Recomputes one parcel's profit and writes it in the caller's transaction. Takes a
 * parcel-scoped advisory lock first, so concurrent recomputes of the same order run
 * one at a time; the lock releases at commit or rollback. Then captures the order's
 * product and seller inputs (`captureOrderProfitSnapshot`, which fills only missing
 * product parts and, while the order's seller inputs are not final, re-derives its
 * cost lists and desi at the order's business-day end) and computes the parcel from
 * them via `computeParcelProfit` (the single
 * per-platform registry), hashes the
 * result, and writes the lines, allocations and both statements only when the stored
 * content hash does not already match. No platform-specific code lives here: a second
 * marketplace registers one computer in PARCEL_PROFIT_COMPUTERS and the writer and the
 * sweep pick it up by themselves. Throws `ParcelNotFoundError` when the order is not
 * this organization's and `UnsupportedPlatformError` for a platform whose registry
 * entry is null -- both raised by `computeParcelProfit`.
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

  // Serialize concurrent recomputes of the same parcel; released at commit/rollback.
  await acquireParcelProfitLock(tx, orderId);

  // Order profit snapshot (plan PR-2, decision 4): capture the order's product and
  // seller inputs if it has none yet, or fill only the missing parts, in this same
  // transaction and under the lock, so the computation below reads the capture. While
  // the order's seller-input marker is NULL the capture also re-derives the cost lists
  // and desi at the order's day end (same-day edit window plan PR-1); the marker is
  // read there, after the lock above, never before it.
  await captureOrderProfitSnapshot(tx, { organizationId, orderId });

  const computed = await computeParcelProfit(tx, params);
  const statements = [computed.estimate, computed.bestKnown];
  const bestKnown = {
    status: computed.bestKnown.status,
    netProfit: computed.bestKnown.netProfit,
  };

  // The hash sees Decimal values at full precision, while the persisted columns are
  // rounded (percentages to 4, vatRatePct to 4). The hashed view is a superset of the
  // stored one, so a change that matters always flips the hash and a needed write is
  // never skipped; at worst two inputs that round to the same row produce different
  // hashes and an identical row is rewritten.
  const hash = profitContentHash({
    engineVersion: PROFIT_ENGINE_VERSION,
    settings: computed.settings,
    lines: computed.lines,
    allocations: computed.allocations,
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
    organizationId: computed.organizationId,
    storeId: computed.storeId,
    orderId,
    settings: computed.settings,
    lines: computed.lines,
    allocations: computed.allocations,
    statements,
    hash,
  });

  return { changed: true, bestKnown };
}

/**
 * Takes the transaction-level advisory lock for one parcel's profit, keyed by the
 * order id. It serializes every writer of one parcel's profit within the caller's
 * transaction: a second caller that asks for the same parcel blocks until the first
 * transaction commits or rolls back, when Postgres releases the lock automatically.
 * Phase 3B writers that change a parcel's profit inputs may take it as their first
 * statement too, to queue behind a running recompute instead of racing it.
 *
 * `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns void, which Prisma
 * cannot deserialize into a row.
 */
export async function acquireParcelProfitLock(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}, ${ADVISORY_LOCK_SEED}::int8))`;
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
    inputs: line.inputs,
    externalRecordId: line.externalRecord?.recordId ?? null,
    externalRecordType: line.externalRecord?.rawType ?? null,
    engineVersion: PROFIT_ENGINE_VERSION,
  }));
  if (lineRows.length > 0) {
    await tx.profitLine.createMany({ data: lineRows });
  }

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
  return value === null ? null : roundPercent(value).toFixed();
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
  readonly reconciliationStatus: ReconciliationStatus;
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
    reconciliationStatus: statement.reconciliationStatus,
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
