import { Decimal } from 'decimal.js';

/**
 * True when the price is still above 0 once rounded to the two decimals it is sent with
 * (`toFixed(2)`). A typed `0,004` is above 0 but goes out as `0.00`, which is no price:
 * the selection route refuses it (422 INVALID_CUSTOM_PRICE).
 */
export function isPositiveAtCents(price: Decimal): boolean {
  return new Decimal(price.toFixed(2)).greaterThan(0);
}
