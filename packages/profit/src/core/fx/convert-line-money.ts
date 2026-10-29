import { roundMoney } from '../../money';
import { type FxConversion, type LineMoney } from '../profit-line';

import { type CurrencyCode } from './currency-code';
import { type SelectedFxRate } from './select-fx-rate';

/**
 * Converts a line amount into the accounting currency. Gross and VAT are each
 * multiplied by the selected rate and rounded to kurus separately, so their sum
 * stays consistent. The returned `fx` carries the original amount, currency,
 * rate, rate date and source; a manual rate flows through the same path.
 */
export function convertLineMoney(
  original: LineMoney,
  currency: CurrencyCode,
  selected: SelectedFxRate,
): { readonly amount: LineMoney; readonly fx: FxConversion } {
  const amount: LineMoney = {
    gross: roundMoney(original.gross.mul(selected.rate)),
    vat: roundMoney(original.vat.mul(selected.rate)),
  };
  const fx: FxConversion = {
    currency,
    original,
    rate: selected.rate,
    rateDate: selected.rateDate,
    source: selected.source,
  };
  return { amount, fx };
}
