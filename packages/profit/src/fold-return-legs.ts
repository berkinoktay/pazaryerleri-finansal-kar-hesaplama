/**
 * Iade kalemlerini (REFUND_DEDUCTION/COMMISSION_REFUND/COST_RETURN/RETURN_SHIPPING)
 * per-leg cozer (gercek-varsa-gercek, yoksa-tahmin) ve ProfitInput'a KATLAR.
 *
 * Katlama, pur motoru (computeProfit) DEGISTIRMEDEN dogru netProfit/netVat uretir:
 *   REFUND_DEDUCTION -> satisi duser | COMMISSION_REFUND -> komisyonu duser
 *   COST_RETURN -> maliyeti duser    | RETURN_SHIPPING -> kargo (SHIPPING) fee'si ekler
 */
import { Decimal } from 'decimal.js';

import type { ProfitInput, ProfitInputFee, ProfitMoneyPair } from './profit-formula';

const ZERO = new Decimal(0);

const grossToVat = (gross: Decimal, rate: Decimal): Decimal =>
  rate.isZero() ? ZERO : gross.mul(rate).div(new Decimal(100).add(rate));

export type ReturnFeeType =
  | 'REFUND_DEDUCTION'
  | 'COMMISSION_REFUND'
  | 'COST_RETURN'
  | 'RETURN_SHIPPING';

export interface ReturnFeeRow {
  feeType: ReturnFeeType;
  source: 'ESTIMATE' | 'SETTLEMENT' | 'CARGO_INVOICE';
  amountGross: Decimal;
  vatRate: Decimal;
}

export type ResolvedReturnLegs = Record<ReturnFeeType, ProfitMoneyPair>;

const RETURN_FEE_TYPES: ReturnFeeType[] = [
  'REFUND_DEDUCTION',
  'COMMISSION_REFUND',
  'COST_RETURN',
  'RETURN_SHIPPING',
];

const ACTUAL_SOURCES = new Set<ReturnFeeRow['source']>(['SETTLEMENT', 'CARGO_INVOICE']);

export function resolveReturnLegs(rows: ReturnFeeRow[]): ResolvedReturnLegs {
  const out: ResolvedReturnLegs = {
    REFUND_DEDUCTION: { gross: ZERO, vat: ZERO },
    COMMISSION_REFUND: { gross: ZERO, vat: ZERO },
    COST_RETURN: { gross: ZERO, vat: ZERO },
    RETURN_SHIPPING: { gross: ZERO, vat: ZERO },
  };
  for (const type of RETURN_FEE_TYPES) {
    const ofType = rows.filter((r) => r.feeType === type);
    const hasActual = ofType.some((r) => ACTUAL_SOURCES.has(r.source));
    const chosen = ofType.filter((r) =>
      hasActual ? ACTUAL_SOURCES.has(r.source) : r.source === 'ESTIMATE',
    );
    let gross = ZERO;
    let vat = ZERO;
    for (const r of chosen) {
      gross = gross.add(r.amountGross);
      vat = vat.add(grossToVat(r.amountGross, r.vatRate));
    }
    out[type] = { gross, vat };
  }
  return out;
}

export function foldReturnLegs(base: ProfitInput, legs: ResolvedReturnLegs): ProfitInput {
  // Düz çıkarma — clamp YOK. İade > satış gibi bir anomali negatif değer üretirse bu
  // KASTEN yansır (sessizce sıfıra çekilmez); alt-kuruş yuvarlama farkı persist'te
  // toDecimalPlaces(2) ile zaten silinir.
  // RETURN_SHIPPING, kargo (SHIPPING DEBIT) fee'si olarak eklenir; gross 0 ise eklenmez
  // (fees[] gereksiz yere kirletilmez).
  const returnShippingFee: ProfitInputFee = {
    type: 'SHIPPING',
    direction: 'DEBIT',
    gross: legs.RETURN_SHIPPING.gross,
    vat: legs.RETURN_SHIPPING.vat,
  };
  const fees = legs.RETURN_SHIPPING.gross.isZero() ? base.fees : [...base.fees, returnShippingFee];
  return {
    sale: {
      gross: base.sale.gross.sub(legs.REFUND_DEDUCTION.gross),
      vat: base.sale.vat.sub(legs.REFUND_DEDUCTION.vat),
    },
    cost: {
      gross: base.cost.gross.sub(legs.COST_RETURN.gross),
      vat: base.cost.vat.sub(legs.COST_RETURN.vat),
    },
    commission: {
      gross: base.commission.gross.sub(legs.COMMISSION_REFUND.gross),
      vat: base.commission.vat.sub(legs.COMMISSION_REFUND.vat),
    },
    fees,
    stoppage: base.stoppage,
  };
}
