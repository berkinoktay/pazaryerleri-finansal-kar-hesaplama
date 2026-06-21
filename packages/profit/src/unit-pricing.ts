import { Decimal } from 'decimal.js';

import { grossToVat } from './money';

// Net profit is affine in price (netProfit = A·P + B); sampling at two prices
// recovers A and B exactly. These are the two sample points.
const SAMPLE_PRICE_LO = new Decimal(0);
const SAMPLE_PRICE_HI = new Decimal(100);
import {
  computeProfit,
  type ProfitBreakdown,
  type ProfitInput,
  type ProfitInputFee,
  type ProfitMoneyPair,
} from './profit-formula';

/**
 * Bir varyantın TEK bir satışının fiyattan-bağımsız ekonomisi. Caller (Dilim 2 API)
 * bunu maliyet profili + komisyon oranı + kargo tahmini + PSF/stopaj FeeDefinition'larından
 * doldurur. Fiyat (`price`) ayrı verilir; bu yapı ondan bağımsızdır.
 */
export interface UnitEconomics {
  /** Satış KDV oranı, yüzde (örn. 20). */
  saleVatRate: Decimal;
  /** Birim maliyet (GROSS + KDV), fiyattan bağımsız sabit. */
  cost: ProfitMoneyPair;
  /** Komisyon oranı, satış GROSS yüzdesi (örn. 18). */
  commissionRate: Decimal;
  /** Komisyon KDV oranı, yüzde (örn. 20). */
  commissionVatRate: Decimal;
  /** Stopaj oranı — NET satış üstüne kesir (örn. 0.01 = %1). */
  stoppageRate: Decimal;
  /** Fiyattan bağımsız sabit ücretler (SHIPPING + PLATFORM_SERVICE), DEBIT, gross+vat dolu. */
  fixedFees: ProfitInputFee[];
}

/**
 * Verili `price` (satış GROSS) için tek-birim `ProfitInput` kurar.
 * **Ara değerlerde yuvarlama YOK** — solver doğrusallığı tam precision'da korur.
 */
export function buildUnitProfitInput(econ: UnitEconomics, price: Decimal): ProfitInput {
  const saleVat = grossToVat(price, econ.saleVatRate);
  const commissionGross = price.mul(econ.commissionRate).div(100);
  const commissionVat = grossToVat(commissionGross, econ.commissionVatRate);
  const saleNet = price.sub(saleVat);
  const stoppageGross = saleNet.mul(econ.stoppageRate);

  return {
    sale: { gross: price, vat: saleVat },
    cost: econ.cost,
    commission: { gross: commissionGross, vat: commissionVat },
    fees: econ.fixedFees,
    stoppage: { gross: stoppageGross },
  };
}

/** Verili fiyatta tek-birim kâr dökümü (forward). */
export function computeUnitProfit(econ: UnitEconomics, price: Decimal): ProfitBreakdown {
  return computeProfit(buildUnitProfitInput(econ, price));
}

export type PriceTarget =
  | { type: 'margin'; value: Decimal } // yüzde (kâr/satış)
  | { type: 'markup'; value: Decimal } // yüzde (kâr/maliyet)
  | { type: 'profit'; value: Decimal }; // TL tutar

export type SolveReason = 'NOT_PRICE_SENSITIVE' | 'UNREACHABLE_TARGET' | 'NO_COST';

export type SolveResult =
  | { calculable: true; price: Decimal; breakdown: ProfitBreakdown }
  | { calculable: false; reason: SolveReason };

/**
 * Hedef (marj/oran/tutar) için gereken satış fiyatını çözer.
 *
 * Net kâr fiyatın doğrusal fonksiyonu: netProfit(P) = A·P + B. İki sentinel fiyatta
 * (P=0 ve P=100) `computeUnitProfit` ile A ve B çıkarılır — formül elle kopyalanmaz,
 * motor değişse bile çözüm tutarlı kalır. Kapalı-form:
 *   profit T : P = (T − B) / A
 *   margin m : P = B / (m − A)        (m = value/100; ulaşılabilir için m < A)
 *   markup r : P = (r·costGross − B) / A   (r = value/100)
 */
export function solvePriceForTarget(econ: UnitEconomics, target: PriceTarget): SolveResult {
  const npAtZero = computeUnitProfit(econ, SAMPLE_PRICE_LO).netProfit;
  const npAtHundred = computeUnitProfit(econ, SAMPLE_PRICE_HI).netProfit;
  const a = npAtHundred.sub(npAtZero).div(SAMPLE_PRICE_HI);
  const b = npAtZero;

  // Fiyat artışı kârı artırmıyorsa (A ≤ 0) anlamlı çözüm yok.
  if (a.lte(0)) {
    return { calculable: false, reason: 'NOT_PRICE_SENSITIVE' };
  }

  let price: Decimal;
  switch (target.type) {
    case 'profit': {
      price = target.value.sub(b).div(a);
      break;
    }
    case 'margin': {
      const m = target.value.div(100);
      const denom = m.sub(a);
      // Maks. ulaşılabilir marj P→∞ iken A'ya yaklaşır; m ≥ A ulaşılamaz.
      if (denom.gte(0)) {
        return { calculable: false, reason: 'UNREACHABLE_TARGET' };
      }
      price = b.div(denom);
      break;
    }
    case 'markup': {
      if (econ.cost.gross.isZero()) {
        return { calculable: false, reason: 'NO_COST' };
      }
      const r = target.value.div(100);
      price = r.mul(econ.cost.gross).sub(b).div(a);
      break;
    }
    default: {
      const _exhaustive: never = target;
      throw new Error(`Unhandled price target: ${JSON.stringify(_exhaustive)}`);
    }
  }

  const rounded = price.toDecimalPlaces(2);
  if (rounded.lte(0)) {
    return { calculable: false, reason: 'UNREACHABLE_TARGET' };
  }

  return { calculable: true, price: rounded, breakdown: computeUnitProfit(econ, rounded) };
}
