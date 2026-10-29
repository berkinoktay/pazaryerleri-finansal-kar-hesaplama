import { Decimal } from 'decimal.js';

import { grossToVat, roundMoney } from '../../money';

const ZERO = new Decimal(0);
const PERCENT_BASE = new Decimal(100);

/**
 * VAT embedded in a VAT-inclusive (gross) amount, rounded to two decimals once.
 * `ratePct` is a percentage (e.g. 20 = 20%). Throws `RangeError` for a negative
 * rate. The single rounded VAT value that a profit line carries.
 */
export function vatFromGross(gross: Decimal, ratePct: Decimal): Decimal {
  if (ratePct.lt(ZERO)) {
    throw new RangeError('ratePct must not be negative');
  }
  return roundMoney(grossToVat(gross, ratePct));
}

/**
 * The VAT-inclusive (gross) amount for a VAT-exclusive (net) tariff amount,
 * rounded to two decimals once. `ratePct` is a percentage (e.g. 20 = 20%).
 * Throws `RangeError` for a negative rate. Marketplace tariffs quoted net
 * (service fee, shipping) become line gross amounts through this single
 * function.
 */
export function grossFromNet(net: Decimal, ratePct: Decimal): Decimal {
  if (ratePct.lt(ZERO)) {
    throw new RangeError('ratePct must not be negative');
  }
  return roundMoney(net.mul(PERCENT_BASE.add(ratePct)).div(PERCENT_BASE));
}
