import { Decimal } from 'decimal.js';

import { grossToVat } from './money';
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
