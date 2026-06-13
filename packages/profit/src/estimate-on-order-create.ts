/**
 * "Tahmini kâr" hesabı — design §4.2 + 2026-06-13 §5 (kargo rafinesi).
 *
 * `applyEstimateOnOrderCreate(orderId, tx)` her order upsert'te (T+0 + her re-sync)
 * çağrılır:
 *   1. PSF (Platform Hizmet Bedeli) deterministic per-order — muafiyet kontrolü ile
 *   2. Stopaj (E-ticaret Stopajı) deterministic per-order
 *   3. Kargo tahmini (order-level estimator; desi = cargoDeci ?? adet-ağırlıklı
 *      ortalama) → SHIPPING ESTIMATE OrderFee (upsert)
 *   4. `computeProfit()` + `Order.estimatedNetProfit` yaz
 *
 * **Rafine edilebilir (write-MANY)** — design 2026-06-13: estimatedNetProfit artık
 * write-once DEĞİL. Kargoya verilip `cargoDeci` gelince fonksiyon yeniden çağrılır
 * ve kargo bedeli rafine olur. Idempotent: PSF/Stopaj skip-if-exists, SHIPPING
 * upsert, maliyet snapshot DB-immutable → aynı (veya kargo-rafine) sonuç.
 *
 * **Maliyet snapshot eksikse**: herhangi bir item'ın `unitCostSnapshotNet`'i null
 * ise `estimatedNetProfit` null bırakılır (cost sonradan gelince re-entry yazar).
 *
 * **Kâr-dışı sipariş** (`profitExcludedAt !== null`): ne fee ne estimate yazılır.
 *
 * Modül `packages/profit/`'te yaşar — apps/api + apps/sync-worker ortak tüketici.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';

import { computeProfit, type ProfitInputFee, type ProfitInputItem } from './profit-formula';
import { isPsfExempt, resolveFeeDefinition } from './resolve-fee-definition';
import { estimateShippingCostForOrder } from './shipping/estimate-order-shipping';

/**
 * Computes and persists `Order.estimatedNetProfit` (refinable) along with the
 * supporting ESTIMATE-source OrderFee rows (PSF + Stopaj + Shipping).
 *
 * Idempotent — safe to call multiple times. Re-entry refines the estimate
 * (esp. shipping once `cargoDeci` lands); it does NOT early-return on a
 * non-null estimate.
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

  // Kâr rafinesi (design 2026-06-13): estimatedNetProfit artık WRITE-ONCE DEĞİL.
  // Kargo bilgisi geldikçe (T+0 ürün-desi → kargoya verilince cargoDeci) yeniden
  // hesaplanır, bu yüzden estimatedNetProfit dolu olsa bile erken return YOK.
  // Fonksiyon idempotent: PSF/Stopaj skip-if-exists, SHIPPING upsert, maliyet
  // snapshot DB-immutable → tekrar çağrı aynı (veya kargo-rafine) sonucu verir.

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

  // ─── 3. Shipping estimate (order-level, design 2026-06-13 §3) ──────────
  // Desi = cargoDeci ?? ürün-ayarı adet-ağırlıklı ortalama → Barem/desi tarifesi.
  // SHIPPING ESTIMATE fee (DEBIT) estimatedNetProfit'i besler. CONFIRMABLE_FEE_TYPES'ta
  // DEĞİL → settled kâra girmez (gerçek CARGO_INVOICE settled'ı besler; çift-sayım yok).
  // Re-entry'de (cargoDeci dolunca / cost backfill) UPSERT: mevcut fee güncellenir.
  // Üretilemezse (carrier yok / desi taşma / own boş) fee yazılmaz, loglanır.
  const shippingOutcome = await estimateShippingCostForOrder(orderId, tx);
  if (shippingOutcome.ok) {
    const shipDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'SHIPPING',
      at: order.orderDate,
    });
    const shipNet = shippingOutcome.estimate.amount;
    const shipVatRate = new Decimal(shipDef.defaultVatRate);
    const shipVat = shipNet.mul(shipVatRate).div(100).toDecimalPlaces(2);
    const existingShip = await tx.orderFee.findFirst({
      where: { orderId, feeType: 'SHIPPING', source: 'ESTIMATE' },
      select: { id: true },
    });
    if (existingShip !== null) {
      await tx.orderFee.update({
        where: { id: existingShip.id },
        data: { amountNet: shipNet, vatRate: shipVatRate, vatAmount: shipVat },
      });
    } else {
      await tx.orderFee.create({
        data: {
          orderId,
          organizationId: order.organizationId,
          feeDefinitionId: shipDef.id,
          feeType: 'SHIPPING',
          source: 'ESTIMATE',
          direction: 'DEBIT',
          amountNet: shipNet,
          vatRate: shipVatRate,
          vatAmount: shipVat,
          displayName: shipDef.displayName,
        },
      });
    }
  } else {
    syncLog.warn('estimate.shipping.unavailable', {
      orderId,
      reason: shippingOutcome.reason,
    });
  }

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
