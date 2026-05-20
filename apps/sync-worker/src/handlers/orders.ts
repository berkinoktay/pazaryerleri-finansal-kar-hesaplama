/**
 * Trendyol orders module handler — one chunk = one page of orders.
 *
 * Order sync flow (Order Sync epic — design §5):
 *   1. Decrypt store credentials
 *   2. Compute window (initial backfill: 90 gün geriye; delta sync PR-D'de)
 *   3. fetchShipmentPackages → MappedOrder[] (PR-A KDV-split mapper)
 *   4. For each MappedOrder:
 *      a. UPSERT Order (idempotent on storeId + platformOrderId, NEW convention)
 *      b. For each MappedOrderLine:
 *         - INSERT OrderItem if not already present (variant barcode lookup)
 *         - captureCostSnapshot(orderItemId, tx)
 *      c. applyEstimateOnOrderCreate(order.id, tx) — T+0 write-once kar tahmini
 *   5. Advance cursor (page+1) within same window; signal done at end
 *
 * Idempotency: re-syncing the same order is safe.
 *   - UPSERT on Order is idempotent.
 *   - INSERT on OrderItem skips existing rows (checked via findFirst on barcode).
 *   - captureCostSnapshot has an internal write-once guard.
 *   - applyEstimateOnOrderCreate has a write-once guard
 *     (`order.estimatedNetProfit !== null` → early return).
 */

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { CostProfileType, Currency, FxRateMode, Prisma, SyncLog, Store } from '@pazarsync/db';
import {
  fetchShipmentPackages,
  isTrendyolCredentials,
  type MappedOrder,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import { applyEstimateOnOrderCreate } from '@pazarsync/profit';
import {
  decryptCredentials,
  parseOrdersCursor,
  syncLog,
  type OrdersCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Initial backfill window — V1 hardcoded 90 gün (design §4.1). */
const INITIAL_BACKFILL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

// ─── Credentials decryption (products.ts mirror) ─────────────────────────────

function decryptStoreCredentials(store: Store): TrendyolCredentials {
  // Prisma's Json column type is `JsonValue`, not `string`; the actual
  // runtime value here is the AES-256-GCM ciphertext base64 blob.
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}

// ─── Core upsert logic — NEW convention (KDV-split native) ────────────────────

/**
 * Persist a single mapped order + its items in one transaction. NEW convention
 * native (design §5.2 + Order Sync design §5.2):
 *
 *   - Order: saleSubtotalNet + saleVatTotal aggregate'ı MappedOrder'dan.
 *     agreedDeliveryDate, actualDeliveryDate, fastDelivery, micro direct API.
 *   - OrderItem: unitPriceNet/VatRate/VatAmount + grossCommissionAmountNet/Vat
 *     + sellerDiscountNet/VatAmount. Variant lookup by barcode (storeId scoped).
 *   - Cost snapshot capture: write-once per item (existing service mirror).
 *   - applyEstimateOnOrderCreate (`@pazarsync/profit`): aynı tx içinde son adım
 *     olarak çağrılır — PSF + Stopaj ESTIMATE OrderFee rows + Order.estimatedNetProfit
 *     write-once. Cost snapshot eksikse profit null kalır; cost profile sonradan
 *     eklenirse recomputation caller'ı (PR-7+) düzeltir.
 *
 * Idempotent:
 *   - Order UPSERT on (storeId, platformOrderId)
 *   - OrderItem INSERT skip-if-exists on (orderId, productVariantId)
 *   - captureCostSnapshot iç guard ile write-once
 *   - applyEstimateOnOrderCreate iç guard ile write-once (estimatedNetProfit set'liyse no-op)
 */
export async function upsertOrderWithSnapshot(
  storeId: string,
  organizationId: string,
  order: MappedOrder,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. UPSERT Order — NEW convention native.
    //    Sale/discount agregat'ı + flagler MappedOrder'dan direkt.
    //    Mutable update: status + actualDeliveryDate + lastModifiedDate-driven values.
    const upserted = await tx.order.upsert({
      where: {
        storeId_platformOrderId: { storeId, platformOrderId: order.platformOrderId },
      },
      create: {
        organizationId,
        storeId,
        platformOrderId: order.platformOrderId,
        platformOrderNumber: order.platformOrderNumber,
        orderDate: order.orderDate,
        status: order.status,
        saleSubtotalNet: order.saleSubtotalNet,
        saleVatTotal: order.saleVatTotal,
        agreedDeliveryDate: order.agreedDeliveryDate,
        actualDeliveryDate: order.actualDeliveryDate,
        fastDelivery: order.fastDelivery,
        micro: order.micro,
      },
      update: {
        status: order.status,
        // actualDeliveryDate sadece null → non-null geçişi için (delivered event'i)
        ...(order.actualDeliveryDate !== null && { actualDeliveryDate: order.actualDeliveryDate }),
      },
    });

    // 2. OrderItem'lar: variant lookup (barcode) + INSERT-if-new + snapshot.
    for (const line of order.lines) {
      const variant = await tx.productVariant.findFirst({
        where: { storeId, barcode: line.barcode },
        select: { id: true },
      });

      // Existing check (write-once snapshot): productVariantId null olabilir
      // (variant barcode'la match'lenemeyen senaryo) — bu durumda findFirst
      // null check'i barcode bazlı değil, productVariantId+orderId bazlı.
      // null productVariantId duplicate'leri engellemek için lineItem'ı orderId
      // başına bir kere yazmak yeterli (Trendyol idempotent sync zaten aynı
      // line'ı tekrar göndermez).
      const existing = await tx.orderItem.findFirst({
        where: { orderId: upserted.id, productVariantId: variant?.id ?? null },
        select: { id: true },
      });
      if (existing !== null) continue;

      if (variant === null) {
        // Variant resolution gap (edge case): productVariantId null bırakılır.
        // UI "variant bulunamadı" badge gösterir (design §6 Edge Cases).
        syncLog.warn('orders.variant-not-found', {
          storeId,
          orderId: upserted.id,
          barcode: line.barcode,
        });
      }

      const item = await tx.orderItem.create({
        data: {
          orderId: upserted.id,
          organizationId,
          productVariantId: variant?.id ?? null,
          quantity: line.quantity,
          // ESKI KDV-dahil kolonları (PR-5c'de silinmediler — backwards compat).
          // unitPrice = unitPriceNet + unitVatAmount; commissionAmount = gross.
          unitPrice: new Decimal(line.unitPriceNet).add(new Decimal(line.unitVatAmount)),
          commissionRate: new Decimal(line.commissionRate),
          commissionAmount: new Decimal(line.grossCommissionAmountNet).add(
            new Decimal(line.grossCommissionVatAmount),
          ),
          // NEW convention (KDV-split native — design §3.2):
          unitPriceNet: new Decimal(line.unitPriceNet),
          unitVatRate: new Decimal(line.unitVatRate),
          unitVatAmount: new Decimal(line.unitVatAmount),
          grossCommissionAmountNet: new Decimal(line.grossCommissionAmountNet),
          grossCommissionVatAmount: new Decimal(line.grossCommissionVatAmount),
          // refundedCommission* PR-5c default 0 — Settlement worker Discount
          // transaction'larından doldurur (PR-7 V1 resume).
          sellerDiscountNet: new Decimal(line.sellerDiscountNet),
          sellerDiscountVatAmount: new Decimal(line.sellerDiscountVatAmount),
        },
      });

      // Cost snapshot capture (write-once iç guard).
      await captureCostSnapshot(item.id, tx);
    }

    // 3. applyEstimateOnOrderCreate — T+0 write-once tahmini kar.
    //    Aynı tx içinde PSF + Stopaj ESTIMATE OrderFee yazar +
    //    Order.estimatedNetProfit set'ler. Cost snapshot eksikse profit null
    //    kalır (re-entry idempotent — cost profile sonradan eklenirse caller
    //    yeniden çağırır).
    await applyEstimateOnOrderCreate(upserted.id, tx);
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Process one page of Trendyol orders.
 *
 * Cursor semantics (OrdersCursor `kind: 'page-window'`):
 *   - First invocation (cursor null): set window = [now − 90d, now], page = 0
 *   - Subsequent: same window, advance page
 *   - Window exhausted (totalElements reached): return done
 *
 * Trendyol fetch + map per PR-A's `fetchShipmentPackages` + `mapTrendyolShipmentPackage`.
 *
 * One chunk = one Trendyol page (≤200 orders). Dispatcher reschedules with
 * advanced cursor; SyncLog progress tracks running count.
 */
export async function processOrdersChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const parsedCursor = parseOrdersCursor(input.cursor);

  // Fresh sync → initial backfill window. Resumed sync → use saved window.
  const now = Date.now();
  const cursor: OrdersCursor = parsedCursor ?? {
    kind: 'page-window',
    startDate: now - INITIAL_BACKFILL_DAYS * MS_PER_DAY,
    endDate: now,
    n: 0,
  };

  syncLog.info('orders.chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor,
    progressCurrent: log.progressCurrent,
  });

  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields ONE page, then we return — dispatcher loops with our cursor.
  const generator = fetchShipmentPackages({
    environment: store.environment,
    credentials,
    startDate: cursor.startDate,
    endDate: cursor.endDate,
    initialPage: cursor.n,
  });
  const { value, done } = await generator.next();

  if (done === true || value === undefined) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'generator-exhausted',
    });
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'empty-page',
    });
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  // Upsert per-order (own transaction). Trendyol bazen aynı page'de duplicate
  // order gönderebilir — upsert idempotent, sorun değil.
  for (const order of batch) {
    try {
      await upsertOrderWithSnapshot(store.id, store.organizationId, order);
    } catch (err) {
      // Per-order resilience: tek malformed order tüm chunk'ı patlatmasın.
      // Edge case (PR-E'de daha kapsamlı recovery): variant constraint vs.
      syncLog.error('orders.upsert.failed', {
        syncLogId: log.id,
        storeId: log.storeId,
        platformOrderId: order.platformOrderId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const newProgress = log.progressCurrent + batch.length;

  // Terminal: tüm window işlendi.
  if (newProgress >= pageMeta.totalElements) {
    syncLog.info('orders.chunk.done', {
      syncLogId: log.id,
      storeId: log.storeId,
      reason: 'window-exhausted',
      finalCount: newProgress,
    });
    return { kind: 'done', finalCount: newProgress };
  }

  const nextCursor: OrdersCursor = {
    kind: 'page-window',
    startDate: cursor.startDate,
    endDate: cursor.endDate,
    n: cursor.n + 1,
  };

  syncLog.info('orders.chunk.complete', {
    syncLogId: log.id,
    storeId: log.storeId,
    pageBatchSize: batch.length,
    newProgress,
    totalElements: pageMeta.totalElements,
    nextCursor,
  });

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'upserting',
  };
}

export const ordersHandler: ModuleHandler = { processChunk: processOrdersChunk };

export { INITIAL_BACKFILL_DAYS };
