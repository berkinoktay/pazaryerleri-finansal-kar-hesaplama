import { Decimal } from 'decimal.js';

import { roundMoney } from '../../money';
import { type LineMoney } from '../../core/profit-line';

const ZERO = new Decimal(0);
const PERCENT_DIVISOR = new Decimal(100);

/** The stoppage base is the VAT-exclusive sale amount: gross minus embedded VAT. */
export function netSaleStoppageBase(sale: LineMoney): Decimal {
  return sale.gross.sub(sale.vat);
}

/**
 * Stoppage withheld on a base amount, rounded to two decimals once.
 * `ratePct` is a percentage (e.g. 1 = 1%). Throws `RangeError` for a negative rate.
 */
export function stoppageAmount(base: Decimal, ratePct: Decimal): Decimal {
  if (ratePct.lt(ZERO)) {
    throw new RangeError('ratePct must not be negative');
  }
  return roundMoney(base.mul(ratePct).div(PERCENT_DIVISOR));
}
