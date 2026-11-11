import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';
import { type ProfitInput, type ProfitInputFee } from '../fixtures/legacy-profit-scenarios';

/** Legacy DEBIT fee type -> new profit line type. CREDIT fees map to ADJUSTMENT_INCOME. */
const DEBIT_FEE_LINE_TYPE = {
  SHIPPING: ProfitLineType.SHIPPING,
  PLATFORM_SERVICE: ProfitLineType.SERVICE_FEE,
  INTERNATIONAL_SERVICE: ProfitLineType.INTERNATIONAL_SERVICE_FEE,
  OVERSEAS_RETURN_OPERATION: ProfitLineType.INTERNATIONAL_OPERATION_FEE,
} as const satisfies Record<ProfitInputFee['type'], ProfitLineType>;

/** Builds a rule/estimate profit line with no inputs and no external record. */
function ruleLine(
  type: ProfitLineType,
  level: ProfitLineLevel,
  orderItemId: string | null,
  amount: LineMoney,
): ProfitLine {
  return createProfitLine({
    type,
    level,
    orderItemId,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount,
    vatRatePct: null,
    inputs: {},
    externalRecord: null,
  });
}

/**
 * Turns a legacy `ProfitInput` into the new profit line model. Every line is an
 * ESTIMATE from the RULE source in Turkish lira with empty inputs; zero amounts are
 * still written as lines. Sale, cost, commission and stoppage are ITEM lines on a
 * single `item-1`; fees are PARCEL lines. DEBIT fees map by type, CREDIT fees
 * (whatever their legacy type) become ADJUSTMENT_INCOME. The equivalence test
 * feeds these lines into the new core and compares against the legacy
 * `computeProfit` values frozen in the scenario fixtures.
 */
export function linesFromLegacyInput(input: ProfitInput): ProfitLine[] {
  const lines: ProfitLine[] = [
    ruleLine(ProfitLineType.SALE, ProfitLineLevel.ITEM, 'item-1', input.sale),
    ruleLine(ProfitLineType.COST_COGS, ProfitLineLevel.ITEM, 'item-1', input.cost),
    ruleLine(ProfitLineType.COMMISSION, ProfitLineLevel.ITEM, 'item-1', input.commission),
    ruleLine(ProfitLineType.STOPPAGE, ProfitLineLevel.ITEM, 'item-1', {
      gross: input.stoppage.gross,
      vat: new Decimal(0),
    }),
  ];

  for (const fee of input.fees) {
    const amount: LineMoney = { gross: fee.gross, vat: fee.vat };
    const type =
      fee.direction === 'DEBIT' ? DEBIT_FEE_LINE_TYPE[fee.type] : ProfitLineType.ADJUSTMENT_INCOME;
    lines.push(ruleLine(type, ProfitLineLevel.PARCEL, null, amount));
  }

  return lines;
}
