/**
 * Shared order-intake routing — the single decision point used by BOTH the
 * webhook receiver (apps/api) and the polling sync-worker (apps/sync-worker)
 * so the two ingest paths behave identically (Slice 0, Decision 1A).
 *
 * Routing (see the spec's decision table + split research 2026-06-09):
 *   - dematerialized (UnPacked)    → DELETE order + buffer rows (split ghost — children re-carry content)
 *   - status CANCELLED             → purge buffer rows + upsert (audit row; aggregates exclude by status)
 *   - variant_not_found            → cost_missing rotası (sipariş YAZILIR; satır null-FK + barkod izi; resolution PR-2)
 *   - calculable                   → upsertOrderWithSnapshot (full profit)
 *   - cost_missing + past-day      → upsertOrderWithSnapshot (null profit) — never lose a sale
 *   - cost_missing + today + in orders → upsertOrderWithSnapshot (idempotent, no buffer)
 *   - cost_missing + today + new   → live_performance_buffer (PENDING, same-day cost-flip window)
 *
 * The "already in orders" guard prevents a phantom buffer row for an order that
 * was costed earlier then had its cost profile archived (would otherwise live in
 * BOTH orders and buffer → double-count on the Live Performance page).
 *
 * cost-missing is graceful in upsertOrderWithSnapshot: captureCostSnapshot leaves
 * the snapshot null and applyEstimateOnOrderCreate leaves estimatedNetProfit null
 * — both re-entry-safe — so a null-profit order can be costed later (Slice C).
 */

import { prisma } from '@pazarsync/db';
import { Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { buildCalcCheckLines, resolveOrderCalculability } from '@pazarsync/profit';
import { getBusinessDate, getBusinessDateAnchor } from '@pazarsync/utils';

import { upsertOrderWithSnapshot } from './upsert-order';

export type OrderIntakeOutcome =
  | {
      kind: 'persisted';
      reason: 'calculable' | 'cost_missing_past_day' | 'already_in_orders' | 'cancelled_audit';
    }
  | { kind: 'buffered' }
  | { kind: 'buffered_deduped' }
  | { kind: 'dematerialized'; deletedOrder: boolean; deletedBufferEntries: number };

export async function intakeOrder(args: {
  storeId: string;
  organizationId: string;
  mapped: MappedOrder;
  /**
   * Original vendor payload for the buffer's `raw_payload` (required column).
   * The webhook passes the Trendyol payload; the sync-worker has only the mapped
   * DTO, so when omitted the mapped order doubles as the raw snapshot.
   */
  rawPayload?: Prisma.InputJsonValue;
}): Promise<OrderIntakeOutcome> {
  const { storeId, organizationId, mapped } = args;

  // ─── Split artifact: UnPacked package dematerialized ─────────────────────
  // Trendyol keeps the pre-split package in the feed with status `UnPacked`
  // while `createdBy="split"` children re-carry its full content under new
  // shipmentPackageIds (research 2026-06-09). Persisting the ghost counts the
  // revenue twice (ghost + children), so the ghost is REMOVED from both books.
  // Hard delete matches the project convention (no soft delete); the
  // WebhookEvent / SyncLog rows keep the audit trail.
  if (mapped.dematerialized) {
    const [orderDel, bufferDel] = await prisma.$transaction([
      prisma.order.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      }),
      prisma.livePerformanceBuffer.deleteMany({
        where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
      }),
    ]);
    return {
      kind: 'dematerialized',
      deletedOrder: orderDel.count > 0,
      deletedBufferEntries: bufferDel.count,
    };
  }

  // ─── Real cancels: purge buffer, persist as audit row ────────────────────
  // A cancelled order produces no payout, so it must never sit in the Live
  // Performance buffer counting volume until the midnight reset. Persist the
  // order itself (audit + ledger visibility); revenue aggregates exclude
  // status=CANCELLED at the query layer.
  if (mapped.status === 'CANCELLED') {
    await prisma.livePerformanceBuffer.deleteMany({
      where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    });
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'cancelled_audit' };
  }

  const calcLines = await buildCalcCheckLines(prisma, { storeId, lines: mapped.lines });
  const calc = resolveOrderCalculability(calcLines);

  // Fully costable → persist with profit.
  if (calc.kind === 'calculable') {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'calculable' };
  }

  // calc is { kind: 'skip', reason: 'cost_missing', ... } from here.
  // Past-day cost-missing → persist null profit (no recovery window for the buffer).
  if (getBusinessDate(mapped.orderDate) < getBusinessDate()) {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'cost_missing_past_day' };
  }

  // Today's cost-missing — but if it is already in orders, persist (idempotent),
  // never create a parallel buffer row (double-count guard). Org-scoped query
  // (CLAUDE.md: every order read filters by organizationId — defense-in-depth).
  const existing = await prisma.order.findFirst({
    where: { organizationId, storeId, platformOrderId: mapped.platformOrderId },
    select: { id: true },
  });
  if (existing !== null) {
    await upsertOrderWithSnapshot(storeId, organizationId, mapped);
    return { kind: 'persisted', reason: 'already_in_orders' };
  }

  // Today's cost-missing, new → buffer (PENDING). Idempotent on (storeId,
  // platformOrderId): a re-delivery hits the composite unique → P2002 → dedupe.
  try {
    await prisma.livePerformanceBuffer.create({
      data: {
        organizationId,
        storeId,
        orderDate: getBusinessDateAnchor(mapped.orderDate),
        platformOrderId: mapped.platformOrderId,
        platformOrderNumber: mapped.platformOrderNumber,
        rawPayload: args.rawPayload ?? (mapped as unknown as Prisma.InputJsonValue),
        mappedOrder: mapped as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
    return { kind: 'buffered' };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { kind: 'buffered_deduped' };
    }
    throw err;
  }
}
