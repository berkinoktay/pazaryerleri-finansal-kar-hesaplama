/**
 * Sipariş anlık tahmin (T+0 write-once kar hesabı) — design §4.2.
 *
 * Sipariş webhook'u geldiği an `applyEstimateOnOrderCreate(orderId, tx)` çağrılır:
 *   1. PSF (Platform Hizmet Bedeli) deterministic per-order — muafiyet kontrolü ile
 *   2. Stopaj (E-ticaret Stopajı) deterministic per-order
 *   3. Shipping estimate (mevcut shipping-estimator entegrasyonu — V1 variant-level fallback)
 *   4. `computeProfit()` çağrı + `Order.estimatedNetProfit` yaz (write-once guard)
 *
 * **Write-once invariant** (design §6.2): Eğer `order.estimatedNetProfit !== null`,
 * fonksiyon erken return eder (idempotent). DB-level trigger PR-9'da eklenecek
 * (defense-in-depth).
 *
 * **Maliyet snapshot eksikse**: Eğer herhangi bir item'ın `unitCostSnapshotNet`'i
 * null ise (cost profile henüz eklenmemiş veya KDV split backfill bekleniyor),
 * `estimatedNetProfit` null bırakılır. Cost profile sonradan eklenirse caller
 * fonksiyonu tekrar çağırır (re-entry idempotent).
 *
 * **Caller'lar:**
 *   - `apps/sync-worker/src/handlers/orders.ts:upsertOrderWithSnapshot` —
 *     T+0 Trendyol order sync sırasında write-once çağrılır (Order Sync PR-B2).
 *   - Standalone integration test'ler (`apps/api/tests/integration/services/
 *     apply-estimate-on-order-create.test.ts`) — mock data ile doğrulama.
 *
 * Modül `apps/api/src/services/profit/`'ten `packages/profit/`'e promote edildi
 * (PR-B2): apps/api ve apps/sync-worker iki ayrı consumer; promotion paylaşımı
 * tek `@pazarsync/profit` paketine indirir, code-duplication önlenir.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import { computeProfit, type ProfitInputFee, type ProfitInputItem } from './profit-formula';
import { isPsfExempt, resolveFeeDefinition } from './resolve-fee-definition';

export class EstimateAlreadyAppliedError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order ${orderId} already has estimatedNetProfit — write-once`);
    this.name = 'EstimateAlreadyAppliedError';
  }
}

/**
 * Computes and persists `Order.estimatedNetProfit` (write-once) along with
 * the supporting ESTIMATE-source OrderFee rows (PSF + Stopaj + Shipping).
 *
 * Idempotent — safe to call multiple times. Re-entry skips early when
 * `estimatedNetProfit` is already non-null.
 */
export async function applyEstimateOnOrderCreate(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { productVariant: true } },
      store: true,
    },
  });
  if (order === null) return;

  // Write-once guard (application layer; DB trigger PR-9'da defense-in-depth)
  if (order.estimatedNetProfit !== null) return;

  // Kâr-dışı sipariş: ne fee ne estimate — kalıcı donuk (spec 2026-06-12).
  if (order.profitExcludedAt !== null) return;

  // Re-entry fee guard: cost_missing siparişlerde T+0 çağrısı PSF/Stopaj'ı
  // YAZAR ama estimate'i null bırakır (allHaveCostSnapshot, aşağıda). Maliyet
  // sonradan gelince (Slice C manuel giriş, variant-resolution tick) fonksiyon
  // yeniden çağrılır — fee'ler tekrar yazılırsa computeProfit 2x PSF + 2x
  // Stopaj toplar ve YANLIŞ kâr write-once kilitlenir. ESTIMATE fee'ler T+0
  // deterministik olduğundan feeType-başına skip-if-exists yeterli.
  const existingEstimateFeeTypes = new Set(
    (
      await tx.orderFee.findMany({
        where: { orderId, source: 'ESTIMATE' },
        select: { feeType: true },
      })
    ).map((fee) => fee.feeType),
  );

  // ─── 1. PSF (Platform Hizmet Bedeli) — deterministic per-order ─────────
  // Muafiyetler: RETURNED, micro=true, all-digital → PSF=0 (OrderFee yazılmaz).
  const psfApplicable = !isPsfExempt(order) && !existingEstimateFeeTypes.has('PLATFORM_SERVICE');
  if (psfApplicable) {
    // T+0'da deliveredOnTime null → conservative standart ₺10.99 kullanılır.
    // T+~5 sale settlement'tan sonra fastDelivery + deliveredOnTime=true doğrulanırsa
    // correction OrderFee CREDIT yazılır (design §4.2 — PR-7'de implement).
    const psfDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'PLATFORM_SERVICE',
      at: order.orderDate,
    });
    if (psfDef.fixedAmountNet === null) {
      throw new Error(`PLATFORM_SERVICE FeeDefinition ${psfDef.id} missing fixedAmountNet`);
    }
    const psfNet = new Decimal(psfDef.fixedAmountNet);
    const psfVatRate = new Decimal(psfDef.defaultVatRate);
    const psfVat = psfNet.mul(psfVatRate).div(100).toDecimalPlaces(2);

    await tx.orderFee.create({
      data: {
        orderId,
        organizationId: order.organizationId,
        feeDefinitionId: psfDef.id,
        feeType: 'PLATFORM_SERVICE',
        source: 'ESTIMATE',
        direction: 'DEBIT',
        amountNet: psfNet,
        vatRate: psfVatRate,
        vatAmount: psfVat,
        displayName: psfDef.displayName,
      },
    });
  }

  // ─── 2. Stopaj (E-ticaret Stopajı) — deterministic per-order ───────────
  // Matrah: saleSubtotalNet × %1 (KDV=0). PSF üzerine stopaj YAPILMAZ
  // (design §3.4 — 330 Tebliği Md 5/2).
  if (order.saleSubtotalNet !== null && !existingEstimateFeeTypes.has('STOPPAGE')) {
    const stopajDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'STOPPAGE',
      at: order.orderDate,
    });
    if (stopajDef.rateOfSale === null) {
      throw new Error(`STOPPAGE FeeDefinition ${stopajDef.id} missing rateOfSale`);
    }
    const stopajNet = new Decimal(order.saleSubtotalNet)
      .mul(new Decimal(stopajDef.rateOfSale))
      .toDecimalPlaces(2);

    await tx.orderFee.create({
      data: {
        orderId,
        organizationId: order.organizationId,
        feeDefinitionId: stopajDef.id,
        feeType: 'STOPPAGE',
        source: 'ESTIMATE',
        direction: 'DEBIT',
        amountNet: stopajNet,
        vatRate: new Decimal(0),
        vatAmount: new Decimal(0),
        displayName: stopajDef.displayName,
      },
    });
  }

  // ─── 3. Shipping estimate (V1 variant-level fallback) ─────────────────
  // Mevcut `estimateShippingCostForOrder` placeholder; V1'de tek variant'lı
  // siparişler için ilk OrderItem'ın variant'ı üzerinden estimate alınır.
  // Multi-variant order'lar için Order-level estimator V2'ye ertelenmiş.
  // Shipping başarısız ise OrderFee yazılmaz — kar hesabı yine yapılır.
  // (PR-7 cargo-invoice gerçek tutarı CARGO_INVOICE source'lu OrderFee olarak yazar.)

  // ─── 4. computeProfit + Order.estimatedNetProfit yaz ───────────────────
  // Tüm cost snapshot'lar dolu mu? Eksikse profit null kalır.
  const allHaveCostSnapshot = order.items.every(
    (item) => item.unitCostSnapshotNet !== null && item.unitCostSnapshotVatAmount !== null,
  );
  if (!allHaveCostSnapshot || order.saleSubtotalNet === null || order.saleVatTotal === null) {
    // Maliyet snapshot eksik veya satış agregat'ı set'lenmemiş → profit null kalır.
    // Cost profile sonradan eklenirse caller bu fonksiyonu tekrar çağırır.
    //
    // NOT dead after PR-B's calculability gate: the gate only guarantees cost
    // at the sync boundary (webhook + cron). upsertOrderWithSnapshot has direct
    // callers that bypass it, and this branch also guards the sale-aggregate
    // nullability the gate never checks. Keep it — fail safe.
    return;
  }

  const fees = await tx.orderFee.findMany({
    where: { orderId, source: 'ESTIMATE' },
    select: { amountNet: true, vatAmount: true, direction: true },
  });

  const profitInputItems: ProfitInputItem[] = order.items.map((item) => ({
    quantity: item.quantity,
    unitCostSnapshotNet: new Decimal(item.unitCostSnapshotNet ?? 0),
    unitCostSnapshotVatAmount: new Decimal(item.unitCostSnapshotVatAmount ?? 0),
    grossCommissionAmountNet: new Decimal(item.grossCommissionAmountNet),
    grossCommissionVatAmount: new Decimal(item.grossCommissionVatAmount),
    refundedCommissionAmountNet: new Decimal(item.refundedCommissionAmountNet),
    refundedCommissionVatAmount: new Decimal(item.refundedCommissionVatAmount),
    sellerDiscountNet: new Decimal(item.sellerDiscountNet),
    sellerDiscountVatAmount: new Decimal(item.sellerDiscountVatAmount),
  }));

  const profitInputFees: ProfitInputFee[] = fees.map((fee) => ({
    amountNet: new Decimal(fee.amountNet),
    vatAmount: new Decimal(fee.vatAmount),
    direction: fee.direction,
  }));

  const profit = computeProfit({
    saleSubtotalNet: new Decimal(order.saleSubtotalNet),
    saleVatTotal: new Decimal(order.saleVatTotal),
    items: profitInputItems,
    fees: profitInputFees,
  });

  await tx.order.update({
    where: { id: orderId },
    data: { estimatedNetProfit: profit.netProfit },
  });
}
