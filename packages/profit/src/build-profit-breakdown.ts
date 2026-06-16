/**
 * Kar dokumu gorunum modeli — GROSS konvansiyonu (Task 13).
 *
 * Gross items (lineSaleGross/commissionGross/unitCostSnapshotGross + vatRate'ler)
 * + fees (amountGross + vatRate, yon-imzali) → 2-ondalik string view + marjlar.
 *
 * netProfit / netVat / marginlar inputtan gelir (motor computeProfit tarafindan
 * zaten hesaplamis + persist edilmis); bu builder kalici gross terimlerden dokumu kurar
 * (kolon sisirmesi yok, "frontend'de hesap yok" korunur).
 *
 * KDV turevi: gross x rate/(100+rate) — gross otoriter, net/vat ayri kolon yok.
 *
 * Frontend ASLA turetmez (feedback_no_frontend_financial_calculation):
 * tek dogru kaynak burasi + computeProfit; UI yalniz render eder.
 */

import { Decimal } from 'decimal.js';

import type { OrderFeeType } from '@pazarsync/db/enums';

const ZERO = new Decimal(0);

const grossToVat = (gross: Decimal, ratePct: number): Decimal => {
  if (ratePct === 0) return ZERO;
  const r = new Decimal(ratePct);
  return gross.mul(r).div(new Decimal(100).add(r));
};

export interface ProfitBreakdownItemInput {
  quantity: number;
  lineListGross: Decimal | null;
  lineSaleGross: Decimal | null;
  lineSellerDiscountGross: Decimal | null;
  saleVatRate: number;
  commissionGross: Decimal;
  refundedCommissionGross: Decimal;
  commissionVatRate: number;
  unitCostSnapshotGross: Decimal | null;
  unitCostSnapshotVatRate: number;
}

export interface ProfitBreakdownFeeInput {
  feeType: OrderFeeType;
  direction: 'DEBIT' | 'CREDIT';
  amountGross: Decimal;
  vatRate: number;
}

export interface BuildProfitBreakdownInput {
  saleGross: Decimal;
  saleVat: Decimal;
  listGross: Decimal;
  sellerDiscountGross: Decimal;
  items: ProfitBreakdownItemInput[];
  fees: ProfitBreakdownFeeInput[];
  netProfit: Decimal;
  netVat: Decimal;
  saleMarginPct: Decimal | null;
  costMarkupPct: Decimal | null;
}

/** Brut (KDV-dahil) terimler + Net KDV kirilimi — hepsi 2-ondalik string. */
export interface ProfitBreakdownView {
  listGross: string;
  sellerDiscountGross: string;
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
  // Stopaj ayrı bir düşülen terim (komisyon/PSF içine katlanmaz). STOPPAGE fee'leri
  // (direction-signed) toplanır; vatRate 0 olduğu için Net KDV'ye GİRMEZ — netProfit'ten
  // doğrudan düşülür (computeProfit ile aynı cebir).
  stoppage: string;
  netVat: string;
  netProfit: string;
  saleMarginPct: string;
  costMarkupPct: string;
}

export function buildProfitBreakdown(input: BuildProfitBreakdownInput): ProfitBreakdownView {
  let costGross = ZERO;
  let costVat = ZERO;
  let commissionGross = ZERO;
  let commissionVat = ZERO;

  for (const item of input.items) {
    const qty = new Decimal(item.quantity);
    const unitCost = (item.unitCostSnapshotGross ?? ZERO).mul(qty);
    costGross = costGross.add(unitCost);
    costVat = costVat.add(grossToVat(unitCost, item.unitCostSnapshotVatRate));

    const effComm = item.commissionGross.sub(item.refundedCommissionGross);
    commissionGross = commissionGross.add(effComm);
    commissionVat = commissionVat.add(grossToVat(effComm, item.commissionVatRate));
  }

  // Fee aggregation: direction-signed (DEBIT subtracts in display, CREDIT adds back)
  const feeAgg = (type: OrderFeeType): { gross: Decimal; vat: Decimal } => {
    let gross = ZERO;
    let vat = ZERO;
    for (const fee of input.fees) {
      if (fee.feeType !== type) continue;
      const signed = fee.direction === 'DEBIT' ? fee.amountGross : fee.amountGross.neg();
      gross = gross.add(signed);
      vat = vat.add(grossToVat(signed.abs(), fee.vatRate).mul(fee.direction === 'DEBIT' ? 1 : -1));
    }
    return { gross, vat };
  };

  const shipping = feeAgg('SHIPPING');
  const platformService = feeAgg('PLATFORM_SERVICE');
  // Stopaj: STOPPAGE fee'leri (vatRate 0). feeAgg yön-imzalı toplar; .gross alınır.
  const stoppage = feeAgg('STOPPAGE');

  return {
    listGross: input.listGross.toFixed(2),
    sellerDiscountGross: input.sellerDiscountGross.toFixed(2),
    saleGross: input.saleGross.toFixed(2),
    saleVat: input.saleVat.toFixed(2),
    costGross: costGross.toFixed(2),
    costVat: costVat.toDecimalPlaces(2).toFixed(2),
    commissionGross: commissionGross.toFixed(2),
    commissionVat: commissionVat.toDecimalPlaces(2).toFixed(2),
    shippingGross: shipping.gross.toFixed(2),
    shippingVat: shipping.vat.toDecimalPlaces(2).toFixed(2),
    platformServiceGross: platformService.gross.toFixed(2),
    platformServiceVat: platformService.vat.toDecimalPlaces(2).toFixed(2),
    stoppage: stoppage.gross.toFixed(2),
    netVat: input.netVat.toFixed(2),
    netProfit: input.netProfit.toFixed(2),
    saleMarginPct: input.saleMarginPct === null ? '—' : input.saleMarginPct.toFixed(2),
    costMarkupPct: input.costMarkupPct === null ? '—' : input.costMarkupPct.toFixed(2),
  };
}
