import { Decimal } from 'decimal.js';

import { getLineSpec } from '../../core/catalog/profit-line-catalog';
import { type ProfitLine } from '../../core/profit-line';

const ZERO = new Decimal(0);

export interface VatTotals {
  readonly output: Decimal;
  readonly input: Decimal;
  readonly net: Decimal;
}

/**
 * Turkish net VAT from already-rounded profit lines. OUTPUT types feed output VAT
 * (income adds, expense such as a sale return subtracts); INPUT types feed input
 * (deductible) VAT (expense adds, income such as a commission refund subtracts);
 * NONE types are ignored. `net = output - input`. Lines carry per-line rounded VAT,
 * so this sums them and never re-rounds the order total.
 */
export function computeVatTotals(lines: readonly ProfitLine[]): VatTotals {
  let output = ZERO;
  let input = ZERO;

  for (const line of lines) {
    const spec = getLineSpec(line.type);
    const vat = line.amount.vat;
    switch (spec.vatKind) {
      case 'OUTPUT':
        output = spec.direction === 'INCOME' ? output.add(vat) : output.sub(vat);
        break;
      case 'INPUT':
        input = spec.direction === 'EXPENSE' ? input.add(vat) : input.sub(vat);
        break;
      case 'NONE':
        break;
      default: {
        const _exhaustive: never = spec.vatKind;
        throw new Error(`Unhandled vat kind: ${_exhaustive}`);
      }
    }
  }

  return { output, input, net: output.sub(input) };
}

/**
 * The net VAT that counts against profit. A negative net VAT (a refund owed to the
 * seller) only lands on the statement when the caller opts in or the sale is an
 * export; otherwise it is floored at zero.
 */
export function effectiveNetVat(
  net: Decimal,
  options: { readonly includeNegativeNetVat: boolean; readonly isExportSale: boolean },
): Decimal {
  if (options.includeNegativeNetVat || options.isExportSale) {
    return net;
  }
  return Decimal.max(net, ZERO);
}
