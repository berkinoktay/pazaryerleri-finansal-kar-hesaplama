import { type Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { getLineSpec } from '../catalog/profit-line-catalog';
import { createProfitLine, type LineMoney, type ProfitLine } from '../profit-line';
import { roundMoney } from '../../money';

/**
 * A cost line is any `PRODUCT_COST` expense line; the cost return (`COST_RETURN`)
 * itself is an income line in the same group, so it is excluded to keep returns
 * from being returned again.
 */
function isCostLine(line: ProfitLine): boolean {
  if (line.type === ProfitLineType.COST_RETURN) {
    return false;
  }
  return getLineSpec(line.type).group === 'PRODUCT_COST';
}

/**
 * Builds a `COST_RETURN` line for every cost line whose item has an accepted
 * return ratio in (0, 1]. The line amount is scaled by the ratio and rounded to
 * kurus. A ratio outside (0, 1] throws `RangeError`; a return that rounds to 0.00
 * writes no line. Lines that are not cost lines are ignored.
 */
export function buildCostReturnLines(params: {
  readonly costLines: readonly ProfitLine[];
  readonly ratioByItem: ReadonlyMap<string, Decimal>;
}): ProfitLine[] {
  const { costLines, ratioByItem } = params;

  for (const ratio of ratioByItem.values()) {
    if (ratio.lte(0) || ratio.gt(1)) {
      throw new RangeError(`return ratio must be in (0, 1]: ${ratio.toString()}`);
    }
  }

  const lines: ProfitLine[] = [];
  for (const line of costLines) {
    if (!isCostLine(line) || line.orderItemId === null) {
      continue;
    }
    const ratio = ratioByItem.get(line.orderItemId);
    if (ratio === undefined) {
      continue;
    }

    const gross = roundMoney(line.amount.gross.mul(ratio));
    if (gross.isZero()) {
      continue;
    }
    const amount: LineMoney = { gross, vat: roundMoney(line.amount.vat.mul(ratio)) };

    lines.push(
      createProfitLine({
        type: ProfitLineType.COST_RETURN,
        level: ProfitLineLevel.ITEM,
        orderItemId: line.orderItemId,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.SELLER_INPUT,
        amount,
        vatRatePct: line.vatRatePct,
        inputs: { returnOf: line.type },
        externalRecord: null,
      }),
    );
  }

  return lines;
}
