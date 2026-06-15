/**
 * Kâr dökümü görünüm modeli (2026-06-15). Berkin'in OTORİTATİF formülünü
 * (Satış − Maliyet − Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr) ekrana
 * koymak için backend-hesaplı brüt (KDV-dahil) toplamları + Net KDV kırılımını
 * üretir. **Frontend ASLA türetmez** (feedback_no_frontend_financial_calculation):
 * tek doğruluk kaynağı burası + computeProfit; UI yalnız render eder.
 *
 * netProfit / netVat persist'ten gelir (estimatedNetProfit + estimatedNetVat,
 * computeProfit yazdı). Brüt toplamlar persist edilmiş kalem/fee'lerden burada
 * toplanır (aynı agregasyon mantığı → drift yok). Tüm değerler 2 ondalık string.
 *
 * Kullanım: order detail + live-performance + karlılık — kârın gösterildiği her
 * yüzeyde AYNI bileşene servis edilir.
 */

import { Decimal } from 'decimal.js';

import type { OrderFeeType } from '@pazarsync/db';

export interface ProfitBreakdownItemInput {
  quantity: number;
  unitCostSnapshotNet: Decimal | null;
  unitCostSnapshotVatAmount: Decimal | null;
  grossCommissionAmountNet: Decimal;
  grossCommissionVatAmount: Decimal;
  refundedCommissionAmountNet: Decimal;
  refundedCommissionVatAmount: Decimal;
  /** Satıcı indirimi (line-total) — liste→net satış şeffaflığı için. Yoksa 0. */
  sellerDiscountNet?: Decimal;
  sellerDiscountVatAmount?: Decimal;
}

export interface ProfitBreakdownFeeInput {
  feeType: OrderFeeType;
  /** DEBIT = düşülen (kargo/PSF/stopaj), CREDIT = eklenen. Yön-bilinçli toplama. */
  direction: 'DEBIT' | 'CREDIT';
  amountNet: Decimal;
  vatAmount: Decimal;
}

export interface BuildProfitBreakdownInput {
  saleSubtotalNet: Decimal;
  saleVatTotal: Decimal;
  items: ProfitBreakdownItemInput[];
  /** Aynı basis'in (estimate VEYA settled) fee satırları — feeType ile ayrışır. */
  fees: ProfitBreakdownFeeInput[];
  /** computeProfit'in yazdığı persist değerler — tek doğruluk. */
  netProfit: Decimal;
  netVat: Decimal;
}

/** Brüt (KDV-dahil) terimler + Net KDV kırılımı — hepsi 2-ondalık string. */
export interface ProfitBreakdownView {
  /** Liste fiyatı brüt = net satış + satıcı indirimi (şeffaflık; indirim yoksa = saleGross). */
  listGross: string;
  /** Satıcı indirimi brüt (≥ 0). '0.00' → indirim yok, UI tek "Satış" satırı gösterir. */
  sellerDiscountGross: string;
  /** Net satış brüt (= effectiveSale, liste − satıcı indirimi). */
  saleGross: string;
  saleVat: string;
  costGross: string;
  costVat: string;
  commissionGross: string;
  commissionVat: string;
  shippingGross: string;
  shippingVat: string;
  platformServiceGross: string;
  platformServiceVat: string;
  /** Stopaj KDV'siz (vatRate 0); brüt = net. */
  stoppageNet: string;
  /** Net KDV = Satış KDV − Maliyet KDV − Komisyon KDV − Kargo KDV − PSF KDV. */
  netVat: string;
  netProfit: string;
}

const ZERO = new Decimal(0);

function gross(net: Decimal, vat: Decimal): string {
  return net.add(vat).toFixed(2);
}

export function buildProfitBreakdown(input: BuildProfitBreakdownInput): ProfitBreakdownView {
  let costNet = ZERO;
  let costVat = ZERO;
  let commissionNet = ZERO;
  let commissionVat = ZERO;
  let sellerDiscountNet = ZERO;
  let sellerDiscountVat = ZERO;

  for (const item of input.items) {
    const qty = new Decimal(item.quantity);
    costNet = costNet.add((item.unitCostSnapshotNet ?? ZERO).mul(qty));
    costVat = costVat.add((item.unitCostSnapshotVatAmount ?? ZERO).mul(qty));
    // Etkin komisyon = brüt − iade (computeProfit ile aynı).
    commissionNet = commissionNet.add(
      item.grossCommissionAmountNet.sub(item.refundedCommissionAmountNet),
    );
    commissionVat = commissionVat.add(
      item.grossCommissionVatAmount.sub(item.refundedCommissionVatAmount),
    );
    // Satıcı indirimi line-total (×qty YOK; commission gibi); yalnız şeffaflık gösterimi
    // (saleSubtotalNet ZATEN effectiveSale = liste − indirim → kâra TEKRAR girmez).
    sellerDiscountNet = sellerDiscountNet.add(item.sellerDiscountNet ?? ZERO);
    sellerDiscountVat = sellerDiscountVat.add(item.sellerDiscountVatAmount ?? ZERO);
  }

  const saleGrossDecimal = input.saleSubtotalNet.add(input.saleVatTotal);
  const sellerDiscountGrossDecimal = sellerDiscountNet.add(sellerDiscountVat);

  // KAPSAM (önemli): bu döküm ESTIMATE-basis fee'lerini bekler — bugün YALNIZCA
  // DEBIT SHIPPING / PLATFORM_SERVICE / STOPPAGE üretiliyor (applyEstimateOnOrderCreate
  // üçünü de DEBIT yazar). feeAgg bilinçli olarak yalnız DEBIT topluyor → ileride bir
  // CREDIT fee (örn. co-funded promo) eklenirse SESSİZCE düşülen gibi gösterilmez (yön
  // bilinçli). Kovalanan üç tip dışında bir feeType eklenirse dökümde satırı olmaz →
  // build-profit-breakdown testindeki "toplam = netProfit" çapraz-kontrolü bunu yakalar;
  // o noktada buraya yeni bir kova + satır eklenmeli.
  const feeAgg = (feeType: OrderFeeType): { net: Decimal; vat: Decimal } => {
    let net = ZERO;
    let vat = ZERO;
    for (const fee of input.fees) {
      if (fee.feeType === feeType && fee.direction === 'DEBIT') {
        net = net.add(fee.amountNet);
        vat = vat.add(fee.vatAmount);
      }
    }
    return { net, vat };
  };

  const shipping = feeAgg('SHIPPING');
  const platformService = feeAgg('PLATFORM_SERVICE');
  const stoppage = feeAgg('STOPPAGE');

  return {
    listGross: saleGrossDecimal.add(sellerDiscountGrossDecimal).toFixed(2),
    sellerDiscountGross: sellerDiscountGrossDecimal.toFixed(2),
    saleGross: saleGrossDecimal.toFixed(2),
    saleVat: input.saleVatTotal.toFixed(2),
    costGross: gross(costNet, costVat),
    costVat: costVat.toFixed(2),
    commissionGross: gross(commissionNet, commissionVat),
    commissionVat: commissionVat.toFixed(2),
    shippingGross: gross(shipping.net, shipping.vat),
    shippingVat: shipping.vat.toFixed(2),
    platformServiceGross: gross(platformService.net, platformService.vat),
    platformServiceVat: platformService.vat.toFixed(2),
    stoppageNet: stoppage.net.toFixed(2),
    netVat: input.netVat.toFixed(2),
    netProfit: input.netProfit.toFixed(2),
  };
}
