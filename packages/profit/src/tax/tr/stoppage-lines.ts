import { Decimal } from 'decimal.js';
import { ProfitLineType } from '@pazarsync/db/enums';

import { type CurrencyCode } from '../../core/fx/currency-code';
import {
  createProfitLine,
  nativeFx,
  type LineMoney,
  type ProfitLine,
} from '../../core/profit-line';
import { netSaleStoppageBase, stoppageAmount } from './stoppage';

const ZERO = new Decimal(0);

interface StoppageBuildParams {
  readonly lines: readonly ProfitLine[];
  readonly sourceType: ProfitLineType;
  readonly outputType: ProfitLineType;
  readonly ratePct: Decimal;
  readonly isExportSale: boolean;
  readonly accountingCurrency: CurrencyCode;
}

/**
 * Builds one stoppage line (on the same level and item) from every input line of
 * `sourceType`. Lines of any other type are ignored. An export sale carries no
 * stoppage, so the result is empty. A stoppage that rounds to 0.00 yields no line.
 */
function buildStoppageFromLines(params: StoppageBuildParams): ProfitLine[] {
  if (params.isExportSale) {
    return [];
  }

  const lines: ProfitLine[] = [];
  for (const line of params.lines) {
    if (line.type !== params.sourceType) {
      continue;
    }

    const base = netSaleStoppageBase(line.amount);
    const gross = stoppageAmount(base, params.ratePct);
    if (gross.equals(ZERO)) {
      continue;
    }

    const amount: LineMoney = { gross, vat: ZERO };
    lines.push(
      createProfitLine({
        type: params.outputType,
        level: line.level,
        orderItemId: line.orderItemId,
        certainty: line.certainty,
        source: line.source,
        amount,
        vatRatePct: null,
        fx: nativeFx(amount, params.accountingCurrency),
        inputs: { base: base.toFixed(2), ratePct: params.ratePct.toString() },
        externalRecord: null,
      }),
    );
  }

  return lines;
}

/**
 * Income tax withheld (stopaj) on the seller's sales. Produces one `STOPPAGE`
 * line per `SALE` line; see `buildStoppageFromLines` for the shared rules.
 */
export function buildStoppageLines(params: {
  readonly saleLines: readonly ProfitLine[];
  readonly ratePct: Decimal;
  readonly isExportSale: boolean;
  readonly accountingCurrency: CurrencyCode;
}): ProfitLine[] {
  return buildStoppageFromLines({
    lines: params.saleLines,
    sourceType: ProfitLineType.SALE,
    outputType: ProfitLineType.STOPPAGE,
    ratePct: params.ratePct,
    isExportSale: params.isExportSale,
    accountingCurrency: params.accountingCurrency,
  });
}

/**
 * Stoppage refunded on returned sales. Produces one `STOPPAGE_REFUND` line per
 * `SALE_RETURN` line; see `buildStoppageFromLines` for the shared rules.
 */
export function buildStoppageRefundLines(params: {
  readonly saleReturnLines: readonly ProfitLine[];
  readonly ratePct: Decimal;
  readonly isExportSale: boolean;
  readonly accountingCurrency: CurrencyCode;
}): ProfitLine[] {
  return buildStoppageFromLines({
    lines: params.saleReturnLines,
    sourceType: ProfitLineType.SALE_RETURN,
    outputType: ProfitLineType.STOPPAGE_REFUND,
    ratePct: params.ratePct,
    isExportSale: params.isExportSale,
    accountingCurrency: params.accountingCurrency,
  });
}
