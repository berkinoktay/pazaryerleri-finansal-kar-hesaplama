/**
 * Profit hesabının canonical (tek doğruluk) fonksiyonu.
 *
 * design §2 — Kar formülü:
 *   Kâr tutarı = Satış fiyatı − Ürün Maliyeti − Komisyon Tutarı − Kargo Ücreti
 *              − Platform Hizmet Bedeli − Net KDV
 *   Net KDV   = Satış KDV − Ürün Maliyeti KDV − Komisyon KDV − Kargo Ücreti KDV
 *              − Platform Hizmet Bedeli KDV
 *
 * design §2.2 matematiksel kanıt: `brüt − Net KDV ≡ net − net`. Bu modül
 * **net konvansiyonu** üzerinde çalışır (`saleSubtotalNet − Σ(costNet) − Σ(feeNet)`),
 * ancak `breakdown` çıktısında brüt değerleri de döner ki UI hem net hem
 * brüt görselleştirebilsin (design §7 sipariş detay timeline).
 *
 * Effective commission (design §3.2):
 *   gross − refunded = effective
 * Discount transaction'ı (Trendyol) ayrı bir komisyon iadesi getiriyor → iki ayrı
 * çift saklıyoruz (grossCommission* + refundedCommission*), bu fonksiyon farkı
 * runtime'da hesaplar.
 *
 * **Fonksiyon hangi modda çağrıldığını bilmez** — caller (applyEstimateOnOrderCreate
 * / recomputeSettledProfit / estimateProductProfit) `items` ve `fees` listesini
 * doldurur. design §4.1: tek formül, 3 mod.
 */

import { Decimal } from 'decimal.js';

const ZERO = new Decimal(0);

export interface ProfitInputItem {
  quantity: number;
  unitCostSnapshotNet: Decimal;
  unitCostSnapshotVatAmount: Decimal;
  // Effective commission = gross − refunded (design §3.2 — Discount handling).
  grossCommissionAmountNet: Decimal;
  grossCommissionVatAmount: Decimal;
  refundedCommissionAmountNet: Decimal;
  refundedCommissionVatAmount: Decimal;
  // Satıcı kaynaklı indirim (gerçek gelir azaltıcı).
  sellerDiscountNet: Decimal;
  sellerDiscountVatAmount: Decimal;
}

export interface ProfitInputFee {
  amountNet: Decimal;
  vatAmount: Decimal;
  direction: 'DEBIT' | 'CREDIT';
}

export interface ProfitInputs {
  saleSubtotalNet: Decimal;
  saleVatTotal: Decimal;
  items: ProfitInputItem[];
  fees: ProfitInputFee[];
}

export interface ProfitBreakdown {
  saleGross: Decimal;
  sellerDiscountGross: Decimal;
  itemCostGross: Decimal;
  commissionGross: Decimal;
  debitFeesGross: Decimal;
  creditFeesGross: Decimal;
  netVat: Decimal;
}

export interface ProfitResult {
  netProfit: Decimal;
  netVat: Decimal;
  breakdown: ProfitBreakdown;
}

/**
 * Computes profit. Pure function — no I/O, no DB. Unit-testable in isolation.
 *
 * Implementation uses **net convention** (design §2.2 matematiksel kanıt):
 *
 *   netProfit = saleSubtotalNet
 *             − Σ(items: unitCostSnapshotNet × quantity)
 *             − Σ(items: effectiveCommissionNet)
 *             + Σ(items: sellerDiscountNet)              // gelir azaltıcı, NEGATIVE etki
 *             − Σ(fees: DEBIT amountNet) + Σ(fees: CREDIT amountNet)
 *
 * Wait — sellerDiscount sign convention'ı netleştir: design §3.2 "İndirim — satıcı
 * kaynaklı (gerçek gelir azaltıcı)" → kar formülünden DÜŞÜLÜR. Yani:
 *
 *   netProfit = saleSubtotalNet − sellerDiscountNet − itemCostNet − effectiveCommissionNet
 *             − debitFeesNet + creditFeesNet
 *
 * netVat aynı yapıda (KDV'lerin algebraic toplamı).
 */
export function computeProfit(input: ProfitInputs): ProfitResult {
  const saleSubtotalNet = new Decimal(input.saleSubtotalNet);
  const saleVatTotal = new Decimal(input.saleVatTotal);

  // ─── Items aggregate ────────────────────────────────────────────────
  let itemCostNet = ZERO;
  let itemCostVat = ZERO;
  let commissionNet = ZERO;
  let commissionVat = ZERO;
  let sellerDiscountNet = ZERO;
  let sellerDiscountVat = ZERO;

  for (const item of input.items) {
    const qty = new Decimal(item.quantity);
    itemCostNet = itemCostNet.add(new Decimal(item.unitCostSnapshotNet).mul(qty));
    itemCostVat = itemCostVat.add(new Decimal(item.unitCostSnapshotVatAmount).mul(qty));

    // effective commission = gross − refunded
    const effCommNet = new Decimal(item.grossCommissionAmountNet).sub(
      new Decimal(item.refundedCommissionAmountNet),
    );
    const effCommVat = new Decimal(item.grossCommissionVatAmount).sub(
      new Decimal(item.refundedCommissionVatAmount),
    );
    commissionNet = commissionNet.add(effCommNet);
    commissionVat = commissionVat.add(effCommVat);

    sellerDiscountNet = sellerDiscountNet.add(new Decimal(item.sellerDiscountNet));
    sellerDiscountVat = sellerDiscountVat.add(new Decimal(item.sellerDiscountVatAmount));
  }

  // ─── Fees aggregate (direction-aware) ────────────────────────────────
  let debitFeesNet = ZERO;
  let debitFeesVat = ZERO;
  let creditFeesNet = ZERO;
  let creditFeesVat = ZERO;

  for (const fee of input.fees) {
    if (fee.direction === 'DEBIT') {
      debitFeesNet = debitFeesNet.add(new Decimal(fee.amountNet));
      debitFeesVat = debitFeesVat.add(new Decimal(fee.vatAmount));
    } else {
      creditFeesNet = creditFeesNet.add(new Decimal(fee.amountNet));
      creditFeesVat = creditFeesVat.add(new Decimal(fee.vatAmount));
    }
  }

  // ─── Net profit ─────────────────────────────────────────────────────
  // Income (net) = saleSubtotalNet − sellerDiscountNet + creditFeesNet
  // Expense (net) = itemCostNet + commissionNet + debitFeesNet
  // Net profit = Income − Expense
  const netProfit = saleSubtotalNet
    .sub(sellerDiscountNet)
    .add(creditFeesNet)
    .sub(itemCostNet)
    .sub(commissionNet)
    .sub(debitFeesNet);

  // ─── Net VAT (algebraic sum of all VAT components) ──────────────────
  // Pass-through tax; tracked separately for UI display + reconciliation.
  // Sale VAT seller collects; cost/commission/fee VAT seller pays.
  const netVat = saleVatTotal
    .sub(sellerDiscountVat)
    .add(creditFeesVat)
    .sub(itemCostVat)
    .sub(commissionVat)
    .sub(debitFeesVat);

  // ─── Breakdown (gross display for UI) ────────────────────────────────
  const saleGross = saleSubtotalNet.add(saleVatTotal);
  const sellerDiscountGross = sellerDiscountNet.add(sellerDiscountVat);
  const itemCostGross = itemCostNet.add(itemCostVat);
  const commissionGross = commissionNet.add(commissionVat);
  const debitFeesGross = debitFeesNet.add(debitFeesVat);
  const creditFeesGross = creditFeesNet.add(creditFeesVat);

  return {
    netProfit,
    netVat,
    breakdown: {
      saleGross,
      sellerDiscountGross,
      itemCostGross,
      commissionGross,
      debitFeesGross,
      creditFeesGross,
      netVat,
    },
  };
}
