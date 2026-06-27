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
import { grossToVat } from './money';

export type ReturnFeeType =
  | 'REFUND_DEDUCTION'
  | 'COMMISSION_REFUND'
  | 'COST_RETURN'
  | 'RETURN_SHIPPING'
  | 'STOPPAGE_REFUND';

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
  'STOPPAGE_REFUND',
];

const ACTUAL_SOURCES = new Set<ReturnFeeRow['source']>(['SETTLEMENT', 'CARGO_INVOICE']);

export function resolveReturnLegs(rows: ReturnFeeRow[]): ResolvedReturnLegs {
  const out: ResolvedReturnLegs = {
    REFUND_DEDUCTION: { gross: new Decimal(0), vat: new Decimal(0) },
    COMMISSION_REFUND: { gross: new Decimal(0), vat: new Decimal(0) },
    COST_RETURN: { gross: new Decimal(0), vat: new Decimal(0) },
    RETURN_SHIPPING: { gross: new Decimal(0), vat: new Decimal(0) },
    STOPPAGE_REFUND: { gross: new Decimal(0), vat: new Decimal(0) },
  };
  for (const type of RETURN_FEE_TYPES) {
    const ofType = rows.filter((r) => r.feeType === type);
    const hasActual = ofType.some((r) => ACTUAL_SOURCES.has(r.source));
    const chosen = ofType.filter((r) =>
      hasActual ? ACTUAL_SOURCES.has(r.source) : r.source === 'ESTIMATE',
    );
    let gross = new Decimal(0);
    let vat = new Decimal(0);
    for (const r of chosen) {
      gross = gross.add(r.amountGross);
      vat = vat.add(grossToVat(r.amountGross, r.vatRate));
    }
    out[type] = { gross, vat };
  }
  return out;
}

/**
 * Net (iade-düşülmüş) satış: ham satış − çözümlenmiş REFUND_DEDUCTION (gerçek-varsa-
 * gerçek, yoksa tahmin). Liste + özet (ciro) yüzeyleri, kâr dökümündeki dispSaleGross
 * ile AYNI net satışı göstermek için kullanır — tek mantık, frontend türetme yok.
 * Yalnız REFUND_DEDUCTION fee'leri verilir (satış netlemesi için diğer leg'ler gereksiz).
 */
export function computeNetSaleGross(
  saleGross: Decimal,
  refundDeductions: ReadonlyArray<{ source: string; amountGross: Decimal; vatRate: Decimal }>,
): Decimal {
  const rows: ReturnFeeRow[] = refundDeductions.map((f) => ({
    feeType: 'REFUND_DEDUCTION',
    source: f.source === 'SETTLEMENT' || f.source === 'CARGO_INVOICE' ? f.source : 'ESTIMATE',
    amountGross: f.amountGross,
    vatRate: f.vatRate,
  }));
  return saleGross.sub(resolveReturnLegs(rows).REFUND_DEDUCTION.gross);
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

  // Stopaj iade'de geri alınır (Berkin kararı 2026-06-20): stopaj satıştan kesilen %1
  // vergidir; satış iade edilince o stopaj nakit gelmese de vergiden mahsup edilir →
  // satıcının gerçek gideri DEĞİLDİR. Diğer bacaklar gibi AÇIK bir STOPPAGE_REFUND
  // (CREDIT) satırıyla geri alınır: TAM iade → tam stopaj geri (net 0); KISMİ iade →
  // iade edilen satışın stopajı kadar. base.stoppage (orijinal) − STOPPAGE_REFUND.
  // Alt sınır 0 (refund > orijinal anomalisi negatif stopaj üretmesin).
  const foldedStoppage = Decimal.max(0, base.stoppage.gross.sub(legs.STOPPAGE_REFUND.gross));

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
    stoppage: { gross: foldedStoppage },
    // Snapshot bayrağı base'ten taşınır — katlama yalnız tutarları değiştirir, kâr-formülü
    // ayarını DEĞİL. Atlanırsa flag tüm estimate/settled iade yolunda sessizce düşerdi.
    includeNegativeNetVat: base.includeNegativeNetVat,
  };
}
