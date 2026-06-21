/**
 * recomputeSettledProfit — settlement-side counterpart of
 * applyEstimateOnOrderCreate. Called by handlePaymentOrderEntry
 * (PR-7 commit 5) once the PaymentOrder cycle marks an Order's
 * ESTIMATE OrderFees as confirmed.
 *
 * INVARIANT (2026-06-14 karar — Hakediş Kontrolü temeli): settledNetProfit =
 * satıcının HAK ETTİĞİ kâr. Satış tabanı = Order.saleGross (effectiveSale, KDV-dahil,
 * hak edilen) — Trendyol'un GERÇEKTE kredilediği OrderItem.settledSaleAmount
 * DEĞİL. Underpaid bir actual-payout'a ASLA sessizce çekilmez. Beklenen (bu
 * fonksiyon) vs gerçek-yatan farkı = gelecek "Hakediş Kontrolü" epiği (itiraz/
 * telafi). Bir gün "settled'ı gerçeğe çekeyim" deme — bu kasıtlı.
 *
 * GROSS konvansiyon (2026-06-16): tüm para terimleri GROSS+vatRate; net/KDV motorda
 * türetilir (computeProfit). Settled kâr settled gross kolonlarından kurulur.
 *
 * Reads:
 *   - Order.saleGross + saleVat  (effectiveSale aggregate = HAK EDİLEN, immutable since arrival)
 *   - OrderItem rows (unitCostSnapshotGross + settled/estimatedCommissionGross + refundedCommissionGross)
 *   - OrderFee rows (amountGross + vatRate) where source ∈ {SETTLEMENT, CARGO_INVOICE}
 *     OR  source = ESTIMATE AND confirmedAt IS NOT NULL; STOPPAGE yalnız onaylanmış
 *     ESTIMATE (stopaj sipariş-bazlı SETTLEMENT OrderFee satırı almaz — bkz. aşağı).
 *
 * Writes:
 *   - Order.settledNetProfit / settledNetVat / settledSaleMarginPct / settledCostMarkupPct
 *     (kâr-DIŞI olmayan siparişte serbestçe güncellenir; kâr-dışı siparişte
 *     reject_profit_freeze_breach hem estimated_* hem settled_* kolonlarını dondurur,
 *     bu yüzden recompute kâr-dışı siparişi erken atlar).
 *
 * Idempotent — pure function of (Order + items + confirmed fees) state.
 * Re-running yields the same value unless new SETTLEMENT/CARGO_INVOICE
 * rows landed or ESTIMATE rows got confirmed since the last call.
 *
 * NULL on incomplete data:
 *   - Any OrderItem with unitCostSnapshotGross = NULL → settle skipped,
 *     settledNetProfit stays at whatever it was (previous null or partial value).
 *   - saleGross / saleVat NULL (no items inserted yet) → skipped.
 *
 * estimatedNetProfit is NEVER touched here. This function writes only the
 * settled_* columns; the estimated_* columns are not modified (the write-once
 * trigger that used to guard them was removed 2026-06-13, but the separation
 * of concerns remains: estimate = T+0 snapshot, settled = settlement-confirmed).
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';

import { computeProfit, type ProfitInputFee } from './profit-formula';
import { foldReturnLegs, resolveReturnLegs, type ReturnFeeRow } from './fold-return-legs';
import { grossToVat } from './money';

export interface RecomputeSettledProfitResult {
  /** True when settledNetProfit was written. False when skipped (logged in caller). */
  recomputed: boolean;
  skipReason?:
    | 'missing_sale_aggregate'
    | 'incomplete_cost_snapshots'
    | 'order_not_found'
    | 'profit_excluded';
  settledNetProfit?: Decimal;
}

export async function recomputeSettledProfit(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<RecomputeSettledProfitResult> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { saleGross: true, saleVat: true, profitExcludedAt: true },
  });
  if (order === null) return { recomputed: false, skipReason: 'order_not_found' };

  // Karar K1 (spec 2026-06-12): kâr-dışı sipariş settled kâr da almaz —
  // settlement fee SATIRLARI işlenmeye devam eder (finansal gerçek), yalnız
  // order-level settled kâr yazımı atlanır.
  if (order.profitExcludedAt !== null) {
    return { recomputed: false, skipReason: 'profit_excluded' };
  }

  if (order.saleGross === null || order.saleVat === null) {
    return { recomputed: false, skipReason: 'missing_sale_aggregate' };
  }

  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      quantity: true,
      unitCostSnapshotGross: true,
      unitCostSnapshotVatRate: true,
      commissionVatRate: true,
      refundedCommissionGross: true,
      estimatedCommissionGross: true,
      settledCommissionGross: true,
    },
  });

  // If any item lacks a cost snapshot, profit can't be computed accurately.
  // Settle is skipped — UI shows "kar hesaplanmadı" until snapshots fill in.
  const missingCost = items.some(
    (i) => i.unitCostSnapshotGross === null || i.unitCostSnapshotVatRate === null,
  );
  if (missingCost) return { recomputed: false, skipReason: 'incomplete_cost_snapshots' };

  // GROSS konvansiyon (2026-06-16): maliyet + komisyon settled gross agregatları.
  // Komisyon = settledCommissionGross (Trendyol gerçek) ?? estimatedCommissionGross
  // (T+0 tahmin), eksi refundedCommissionGross (net-satış tabanı #332). KDV item-bazlı.
  //
  // KDV türevi TAM PRECISION'da biriktirilir — per-line `.toDecimalPlaces(2)` YOK.
  // Tek yuvarlama persist'te (settledNetVat/settledNetProfit → toDecimalPlaces(2)).
  // build-profit-breakdown.ts (görünüm yolu) ile birebir uyuşur; per-line yuvarlama
  // çok-kalemli siparişte bileşik kuruş kaymasına yol açardı.
  let costGross = new Decimal(0);
  let costVat = new Decimal(0);
  let commissionGross = new Decimal(0);
  let commissionVat = new Decimal(0);
  for (const item of items) {
    const qty = new Decimal(item.quantity);
    const lineCost = new Decimal(item.unitCostSnapshotGross!).mul(qty);
    costGross = costGross.add(lineCost);
    costVat = costVat.add(grossToVat(lineCost, new Decimal(item.unitCostSnapshotVatRate!)));
    const settledComm = item.settledCommissionGross ?? item.estimatedCommissionGross;
    const effComm = new Decimal(settledComm ?? 0).sub(new Decimal(item.refundedCommissionGross));
    commissionGross = commissionGross.add(effComm);
    commissionVat = commissionVat.add(grossToVat(effComm, new Decimal(item.commissionVatRate)));
  }

  // Confirmed fees: SETTLEMENT + CARGO_INVOICE rows, plus ESTIMATE rows the
  // PaymentOrder cycle marked confirmed. SHIPPING/PLATFORM_SERVICE only (stopaj
  // ayrı `stoppage` terimi; iade-leg'leri ayrı feeType → motor input'una girmez).
  const confirmedFees = await tx.orderFee.findMany({
    where: {
      orderId,
      feeType: { in: ['SHIPPING', 'PLATFORM_SERVICE'] },
      OR: [
        { source: { in: ['SETTLEMENT', 'CARGO_INVOICE'] } },
        { source: 'ESTIMATE', confirmedAt: { not: null } },
      ],
    },
    select: { feeType: true, amountGross: true, vatRate: true, direction: true },
  });
  const profitInputFees: ProfitInputFee[] = confirmedFees.map((f) => ({
    type: f.feeType === 'SHIPPING' ? 'SHIPPING' : 'PLATFORM_SERVICE',
    gross: new Decimal(f.amountGross),
    // KDV tam precision (per-fee yuvarlama YOK); tek yuvarlama persist'te.
    vat: grossToVat(new Decimal(f.amountGross), new Decimal(f.vatRate)),
    direction: f.direction,
  }));

  // Stopaj terimi: onaylanmış ESTIMATE STOPPAGE. Stopaj sipariş-bazlı ayrı bir
  // SETTLEMENT OrderFee satırı ALMAZ — settlement'ta ödeme-periyodu-bazlı OrgPeriodFee
  // olarak (aggregate, audit-only) yazılır. Bu yüzden PaymentOrder onayının ESTIMATE
  // STOPPAGE'ı confirmedAt ile işaretlemesi gerçek-değer için yeterlidir; eski
  // `source:'SETTLEMENT'` kolu yapısal olarak hiç eşleşmediği için kaldırıldı.
  const stoppageFee = await tx.orderFee.findFirst({
    where: {
      orderId,
      feeType: 'STOPPAGE',
      source: 'ESTIMATE',
      confirmedAt: { not: null },
    },
    select: { amountGross: true },
  });

  // İade bacakları: 4 iade feeType'ı, per-leg gerçek (SETTLEMENT/CARGO_INVOICE) varsa
  // gerçek, yoksa onaylanmış ESTIMATE. Forward SHIPPING/PSF ayrı (confirmedFees) — çift-sayım yok.
  const returnFeeRows = await tx.orderFee.findMany({
    where: {
      orderId,
      feeType: {
        in: [
          'REFUND_DEDUCTION',
          'COMMISSION_REFUND',
          'COST_RETURN',
          'RETURN_SHIPPING',
          'STOPPAGE_REFUND',
        ],
      },
      OR: [
        { source: { in: ['SETTLEMENT', 'CARGO_INVOICE'] } },
        { source: 'ESTIMATE', confirmedAt: { not: null } },
      ],
    },
    select: { feeType: true, source: true, amountGross: true, vatRate: true },
  });

  // DB enums (OrderFeeType / OrderFeeSource) are supersets of the helper's
  // string-literal unions. The `as` casts are safe: the `where` filter above
  // guarantees only the four return feeTypes and three real/confirmed sources
  // are returned, matching ReturnFeeRow exactly.
  const returnLegs = resolveReturnLegs(
    returnFeeRows.map(
      (f): ReturnFeeRow => ({
        feeType: f.feeType as ReturnFeeRow['feeType'],
        source: f.source as ReturnFeeRow['source'],
        amountGross: new Decimal(f.amountGross),
        vatRate: new Decimal(f.vatRate),
      }),
    ),
  );

  const result = computeProfit(
    foldReturnLegs(
      {
        sale: { gross: new Decimal(order.saleGross), vat: new Decimal(order.saleVat) },
        cost: { gross: costGross, vat: costVat },
        commission: { gross: commissionGross, vat: commissionVat },
        fees: profitInputFees,
        stoppage: { gross: new Decimal(stoppageFee?.amountGross ?? 0) },
      },
      returnLegs,
    ),
  );

  const settledNetProfit = result.netProfit.toDecimalPlaces(2);
  const settledNetVat = result.netVat.toDecimalPlaces(2);
  await tx.order.update({
    where: { id: orderId },
    data: {
      settledNetProfit,
      settledNetVat,
      // Marj %'leri backend-hesaplı + persist (sıralanabilir, spec ekleme #2).
      settledSaleMarginPct: result.saleMarginPct?.toDecimalPlaces(4) ?? null,
      settledCostMarkupPct: result.costMarkupPct?.toDecimalPlaces(4) ?? null,
    },
  });

  return { recomputed: true, settledNetProfit };
}
