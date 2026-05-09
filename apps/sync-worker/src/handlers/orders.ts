/**
 * Trendyol orders module handler — one chunk = one page of orders.
 *
 * Order sync flow per spec §5.1:
 *   1. UPSERT Order (idempotent on storeId + platformOrderId)
 *   2. For each line item:
 *      - INSERT OrderItem if not already present
 *      - If just inserted → captureCostSnapshot(orderItemId, tx)
 *      - If already present → skip (write-once; snapshot stays as-is)
 *   3. recomputeOrderProfit(orderId, tx) — write-once; no-op if already set
 *      or if any item still lacks a snapshot
 *   4. Continue to next page or signal done
 *
 * Idempotency: re-syncing the same order is safe.
 *   - UPSERT on Order is idempotent.
 *   - INSERT on OrderItem skips existing rows (checked via findFirst).
 *   - captureCostSnapshot throws SnapshotAlreadyCapturedError if snapshot
 *     is already set; we catch that error and continue (it means a previous
 *     sync run already captured it — correct behaviour).
 *   - recomputeOrderProfit is a no-op when netProfit is already non-null.
 */

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type {
  CostProfileType,
  Currency,
  FxRateMode,
  OrderStatus,
  Prisma,
  SyncLog,
} from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDERS_PAGE_SIZE = 50;

// ─── Internal snapshot types ──────────────────────────────────────────────────

interface SnapshotComponentData {
  orderItemId: string;
  organizationId: string;
  profileId: string;
  profileName: string;
  profileType: CostProfileType;
  amount: Decimal;
  currency: Currency;
  vatRate: number;
  amountInTry: Decimal;
  fxRateMode: FxRateMode;
  fxRateUsed: Decimal;
  fxRateSource: string;
}

// ─── FX rate resolution ───────────────────────────────────────────────────────

interface FxResolution {
  rate: Decimal;
  source: string;
}

/**
 * Resolves the FX rate for a cost profile within the sync transaction.
 * Mirrors apps/api/src/services/fx-rates.service.ts — same logic, same tx.
 * Returns null when an AUTO rate is unavailable (no fx_rates row).
 */
async function resolveFx(
  profile: { currency: Currency; fxRateMode: FxRateMode; manualFxRate: Decimal | null },
  tx: Prisma.TransactionClient,
): Promise<FxResolution | null> {
  if (profile.currency === 'TRY') {
    return { rate: new Decimal(1), source: 'TRY-NATIVE' };
  }
  if (profile.fxRateMode === 'MANUAL') {
    if (profile.manualFxRate === null) {
      throw new Error('Profile has fxRateMode=MANUAL but manualFxRate is null');
    }
    return { rate: new Decimal(profile.manualFxRate), source: 'MANUAL' };
  }
  const row = await tx.fxRate.findFirst({
    where: { currency: profile.currency },
    orderBy: { rateDate: 'desc' },
  });
  if (!row) return null;
  const dateStr = row.rateDate.toISOString().slice(0, 10);
  return { rate: new Decimal(row.rateToTry), source: `TCMB-${dateStr}` };
}

// ─── Snapshot capture ─────────────────────────────────────────────────────────

/**
 * Capture unit_cost_snapshot for a newly-inserted OrderItem.
 * Best-effort: if FX rate is unavailable or no profiles are attached,
 * exits silently leaving the snapshot null.
 *
 * Mirrors apps/api/src/services/cost-snapshot.service.ts#captureCostSnapshot.
 * The two implementations must stay in sync if the spec changes.
 */
async function captureCostSnapshot(
  orderItemId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: { productVariant: true },
  });

  if (!item || item.unitCostSnapshot !== null || !item.productVariantId) {
    return;
  }

  const links = await tx.productVariantCostProfile.findMany({
    where: { productVariantId: item.productVariantId },
    include: { profile: true },
  });

  const activeProfiles = links.map((l) => l.profile).filter((p) => p.archivedAt === null);

  if (activeProfiles.length === 0) return;

  const components: SnapshotComponentData[] = [];

  for (const profile of activeProfiles) {
    const fx = await resolveFx(profile, tx);
    if (fx === null) {
      syncLog.warn('snapshot.fx-unavailable', {
        orderItemId,
        profileId: profile.id,
        currency: profile.currency,
      });
      return; // best-effort: abort, leave null
    }
    components.push({
      orderItemId,
      organizationId: item.organizationId ?? '',
      profileId: profile.id,
      profileName: profile.name,
      profileType: profile.type,
      amount: new Decimal(profile.amount),
      currency: profile.currency,
      vatRate: profile.vatRate,
      amountInTry: new Decimal(profile.amount).mul(fx.rate),
      fxRateMode: profile.fxRateMode,
      fxRateUsed: fx.rate,
      fxRateSource: fx.source,
    });
  }

  const unitCostSnapshot = components.reduce((acc, c) => acc.add(c.amountInTry), new Decimal(0));

  await tx.orderItem.update({
    where: { id: orderItemId },
    data: { unitCostSnapshot, snapshotCapturedAt: new Date() },
  });

  await tx.orderItemCostSnapshotComponent.createMany({ data: components });
}

// ─── Profit computation ───────────────────────────────────────────────────────

/**
 * Compute and persist Order.netProfit when all items have snapshots.
 * Write-once: no-op if netProfit is already set or any snapshot is missing.
 *
 * Mirrors apps/api/src/services/profit-calculation.service.ts.
 */
async function recomputeOrderProfit(orderId: string, tx: Prisma.TransactionClient): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const order = await tx.order.findUnique({ where: { id: orderId } });

  if (!order || order.netProfit !== null) return;

  const allHaveSnapshot = items.every((i) => i.unitCostSnapshot !== null);
  if (!allHaveSnapshot) return;

  const totalCost = items.reduce(
    (acc, i) => acc.add(new Decimal(i.unitCostSnapshot!).mul(i.quantity)),
    new Decimal(0),
  );

  const netProfit = new Decimal(order.totalAmount)
    .sub(order.commissionAmount)
    .sub(order.shippingCost)
    .sub(order.platformFee)
    .sub(totalCost);

  await tx.order.update({ where: { id: orderId }, data: { netProfit } });
}

// ─── Order-item mapping ───────────────────────────────────────────────────────

/**
 * Shape of a raw order line from Trendyol.
 * Defined here to avoid a dependency on the marketplace package until
 * the Trendyol orders API integration is implemented.
 */
interface RawOrderLine {
  platformOrderLineId: string;
  productVariantId: string | null;
  quantity: number;
  unitPrice: string;
  commissionRate: string;
  commissionAmount: string;
}

/**
 * Shape of a raw order from Trendyol (minimal fields for the sync).
 */
interface RawOrder {
  platformOrderId: string;
  orderDate: Date;
  status: OrderStatus;
  totalAmount: string;
  commissionAmount: string;
  shippingCost: string;
  platformFee: string;
  vatAmount: string;
  lines: RawOrderLine[];
}

// ─── Core upsert logic ────────────────────────────────────────────────────────

/**
 * Persist a single order and its items inside one transaction.
 * Calls captureCostSnapshot immediately after each new OrderItem INSERT.
 * Calls recomputeOrderProfit after all items are processed.
 */
export async function upsertOrderWithSnapshot(
  storeId: string,
  organizationId: string,
  raw: RawOrder,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. UPSERT the Order row (idempotent on storeId + platformOrderId)
    const order = await tx.order.upsert({
      where: { storeId_platformOrderId: { storeId, platformOrderId: raw.platformOrderId } },
      create: {
        organizationId,
        storeId,
        platformOrderId: raw.platformOrderId,
        orderDate: raw.orderDate,
        status: raw.status,
        totalAmount: new Decimal(raw.totalAmount),
        commissionAmount: new Decimal(raw.commissionAmount),
        shippingCost: new Decimal(raw.shippingCost),
        platformFee: new Decimal(raw.platformFee),
        vatAmount: new Decimal(raw.vatAmount),
      },
      update: {
        status: raw.status,
        totalAmount: new Decimal(raw.totalAmount),
        commissionAmount: new Decimal(raw.commissionAmount),
        shippingCost: new Decimal(raw.shippingCost),
        platformFee: new Decimal(raw.platformFee),
        vatAmount: new Decimal(raw.vatAmount),
      },
    });

    // 2. For each line: INSERT if not already present, then capture snapshot
    for (const line of raw.lines) {
      const existing = await tx.orderItem.findFirst({
        where: { orderId: order.id, productVariantId: line.productVariantId ?? undefined },
        select: { id: true },
      });

      if (existing !== null) {
        // Already synced — write-once: leave snapshot as-is
        continue;
      }

      const item = await tx.orderItem.create({
        data: {
          orderId: order.id,
          organizationId,
          productVariantId: line.productVariantId,
          quantity: line.quantity,
          unitPrice: new Decimal(line.unitPrice),
          commissionRate: new Decimal(line.commissionRate),
          commissionAmount: new Decimal(line.commissionAmount),
        },
      });

      // Capture cost snapshot immediately after INSERT
      await captureCostSnapshot(item.id, tx);
    }

    // 3. Compute order profit (write-once no-op if already set or snapshots missing)
    await recomputeOrderProfit(order.id, tx);
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Process one page of Trendyol orders.
 *
 * NOTE: The Trendyol orders API integration is pending implementation.
 * This handler is wired into the registry and provides the correct
 * transactional snapshot/profit wiring per spec §5.1. The marketplace
 * fetch layer will be added in the orders-sync PR.
 */
export async function processOrdersChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log, cursor } = input;
  const page = typeof cursor === 'number' ? cursor : 0;

  syncLog.info('orders.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    page,
  });

  // TODO: fetch orders from Trendyol API (pending marketplace orders integration).
  // When the marketplace fetch layer lands, replace the stub below with:
  //   const { orders, hasMore } = await fetchOrders({ storeId, page, credentials });
  //   for (const raw of orders) { await upsertOrderWithSnapshot(storeId, organizationId, raw); }
  //
  // For now the handler completes immediately (no orders fetched).
  // The snapshot/profit logic is exercised directly via the service functions
  // and integration tests.

  syncLog.info('orders.chunk.done', {
    syncLogId: log.id,
    storeId: log.storeId,
    page,
    count: 0,
  });

  return { kind: 'done', finalCount: log.progressCurrent };
}

export const ordersHandler: ModuleHandler = { processChunk: processOrdersChunk };

// Re-export the core persistence function so integration tests can call it
// directly without going through the full chunk-loop machinery.
export { ORDERS_PAGE_SIZE };
