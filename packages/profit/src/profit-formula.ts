/**
 * Kâr hesabının canonical (tek doğruluk) saf motoru — GROSS konvansiyonu.
 *
 * spec §2 — Kar formülü (GROSS):
 *   netVat    = saleVat − (costVat + commissionVat + Σ feeVat)  [stopaj HARİÇ]
 *   netProfit = saleGross − costGross − commissionGross − Σ feeGross − stoppage − netVat
 *   DEBIT fees düşülür, CREDIT fees geri eklenir.
 *   saleMarginPct  = netProfit / saleGross × 100  (saleGross=0 → null)
 *   costMarkupPct  = netProfit / costGross × 100  (costGross=0 → null)
 *
 * **Bu modül entity/db import etmez.** Sadece decimal.js. Caller (estimate-on-order-create /
 * recompute-settled-profit) gross+vat çiftlerini doldurur → tek formül, 3 mod (spec §4.1).
 */

import { Decimal } from 'decimal.js';

export interface ProfitMoneyPair {
  gross: Decimal;
  vat: Decimal;
}

export interface ProfitInputFee {
  // INTERNATIONAL_SERVICE (Uluslararası Hizmet Bedeli) + OVERSEAS_RETURN_OPERATION
  // (Yurt Dışı İade Operasyon Bedeli) mikro ihracata özgüdür; matematiğe DEBIT olarak
  // girer; ProfitBreakdown'da ayrı kovası YOK (görünüm yolu build-profit-breakdown
  // OrderFee satırlarından kurar — computeProfit kovaları yalnız unit-pricing quote'unda
  // kullanılır, orada mikro yok).
  type: 'SHIPPING' | 'PLATFORM_SERVICE' | 'INTERNATIONAL_SERVICE' | 'OVERSEAS_RETURN_OPERATION';
  gross: Decimal;
  vat: Decimal;
  direction: 'DEBIT' | 'CREDIT';
}

export interface ProfitInput {
  sale: ProfitMoneyPair;
  cost: ProfitMoneyPair;
  commission: ProfitMoneyPair;
  fees: ProfitInputFee[];
  stoppage: { gross: Decimal };
  // Negatif net KDV (KDV alacağı) kâra dahil edilsin mi? false → netVat<0 ise 0'a klamplanır
  // (alacak kârı şişirmez); netVat≥0 her zaman düşülür. Mağaza-bazlı snapshot'tan gelir
  // (order-create'te Order'a yazılan değer; @pazarsync/utils resolveSnapshotProfitSettings).
  // Eski/değişmemiş davranış için caller true geçer.
  includeNegativeNetVat: boolean;
}

export interface ProfitBreakdown {
  listGross: Decimal;
  sellerDiscountGross: Decimal;
  saleGross: Decimal;
  saleVat: Decimal;
  costGross: Decimal;
  costVat: Decimal;
  commissionGross: Decimal;
  commissionVat: Decimal;
  shippingGross: Decimal;
  shippingVat: Decimal;
  platformServiceGross: Decimal;
  platformServiceVat: Decimal;
  stoppage: Decimal;
  netVat: Decimal;
  netProfit: Decimal;
  saleMarginPct: Decimal | null;
  costMarkupPct: Decimal | null;
}

/**
 * Computes profit. Pure function — no I/O, no DB. Unit-testable in isolation.
 *
 * Formula (spec §2, GROSS convention):
 *   netVat         = saleVat − costVat − commissionVat − Σ(DEBIT feeVat) + Σ(CREDIT feeVat)
 *                    [stopaj HARİÇ netVat'tan — direkt netProfit'ten düşülür]
 *   effectiveNetVat = includeNegativeNetVat ? netVat : max(netVat, 0)
 *   netProfit       = saleGross − costGross − commissionGross
 *                    − Σ(DEBIT feeGross) + Σ(CREDIT feeGross) − stoppage − effectiveNetVat
 * Dönen ProfitBreakdown.netVat = effectiveNetVat (saklanır/gösterilir; döküm kapanır).
 */
export function computeProfit(input: ProfitInput): ProfitBreakdown {
  let shippingGross = new Decimal(0);
  let shippingVat = new Decimal(0);
  let platformServiceGross = new Decimal(0);
  let platformServiceVat = new Decimal(0);
  let debitVat = new Decimal(0);
  let creditVat = new Decimal(0);
  let debitGross = new Decimal(0);
  let creditGross = new Decimal(0);

  for (const fee of input.fees) {
    if (fee.type === 'SHIPPING') {
      shippingGross = shippingGross.add(fee.gross);
      shippingVat = shippingVat.add(fee.vat);
    } else if (fee.type === 'PLATFORM_SERVICE') {
      platformServiceGross = platformServiceGross.add(fee.gross);
      platformServiceVat = platformServiceVat.add(fee.vat);
    }
    // INTERNATIONAL_SERVICE + OVERSEAS_RETURN_OPERATION (mikro ihracat): ProfitBreakdown'da
    // ayrı kova yok (kasıtlı) — yalnız aşağıdaki DEBIT/CREDIT matematiğine girer;
    // platformService'e KARIŞTIRILMAZ.
    if (fee.direction === 'DEBIT') {
      debitGross = debitGross.add(fee.gross);
      debitVat = debitVat.add(fee.vat);
    } else {
      creditGross = creditGross.add(fee.gross);
      creditVat = creditVat.add(fee.vat);
    }
  }

  // Net KDV (spec §2): stopaj HARİÇ. CREDIT feeVat geri eklenir. Ham (gerçek) değer.
  const netVat = input.sale.vat
    .sub(input.cost.vat)
    .sub(input.commission.vat)
    .sub(debitVat)
    .add(creditVat);

  // Negatif net KDV (KDV alacağı) opsiyonu: kapalıyken (includeNegativeNetVat=false) net KDV
  // negatifse 0'a klamplanır (alacak kârı şişirmez); pozitif net KDV her zaman düşülür.
  // Açıkken (true) eski davranış: negatif net KDV kâra eklenir (sub(negatif) = ekleme).
  const effectiveNetVat = input.includeNegativeNetVat
    ? netVat
    : Decimal.max(netVat, new Decimal(0));

  const netProfit = input.sale.gross
    .sub(input.cost.gross)
    .sub(input.commission.gross)
    .sub(debitGross)
    .add(creditGross)
    .sub(input.stoppage.gross)
    .sub(effectiveNetVat);

  const saleMarginPct = input.sale.gross.isZero() ? null : netProfit.div(input.sale.gross).mul(100);

  const costMarkupPct = input.cost.gross.isZero() ? null : netProfit.div(input.cost.gross).mul(100);

  return {
    listGross: input.sale.gross, // adapter override eder (BuildProfitBreakdownInput'tan items üzerinden)
    sellerDiscountGross: new Decimal(0), // adapter override eder
    saleGross: input.sale.gross,
    saleVat: input.sale.vat,
    costGross: input.cost.gross,
    costVat: input.cost.vat,
    commissionGross: input.commission.gross,
    commissionVat: input.commission.vat,
    shippingGross,
    shippingVat,
    platformServiceGross,
    platformServiceVat,
    stoppage: input.stoppage.gross,
    // Saklanan/gösterilen net KDV = effectiveNetVat (klamplı): kâr dökümü matematiksel kapanır
    // (netProfit = saleGross − … − netVat). includeNegativeNetVat=true iken netVat===effectiveNetVat.
    netVat: effectiveNetVat,
    netProfit,
    saleMarginPct,
    costMarkupPct,
  };
}
