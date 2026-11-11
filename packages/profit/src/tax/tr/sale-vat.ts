import { Decimal } from 'decimal.js';

const ZERO = new Decimal(0);

/**
 * The VAT rate that applies to a sale line. An export sale carries 0% sale VAT
 * (Turkish export exemption); every other sale keeps the product's VAT rate.
 * `productVatRatePct` is a percentage (e.g. 20 = 20%).
 */
export function saleVatRatePct(productVatRatePct: Decimal, isExportSale: boolean): Decimal {
  return isExportSale ? ZERO : productVatRatePct;
}
