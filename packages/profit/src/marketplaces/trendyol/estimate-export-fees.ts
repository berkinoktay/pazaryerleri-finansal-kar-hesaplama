import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { activeItems, type ParcelSnapshot } from '../../core/parcel-snapshot';
import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';
import { roundMoney } from '../../money';
import { vatFromGross } from '../../tax/tr/vat';
import { type TrendyolFeeParams } from './trendyol-inputs';

const ZERO = new Decimal(0);
/** Percent rates are expressed per hundred; the divisor that turns a rate into a factor. */
const PERCENT = new Decimal(100);

/**
 * The Trendyol international service fee (micro-export), computed once per parcel
 * (plan decision 13): the VAT-inclusive parcel sale times the fee rate, rounded a
 * single time. Only an export parcel with at least one active item is charged; a
 * domestic parcel, an empty parcel, or a zero gross writes no line. The base is the
 * sum of the active items' sale amounts (list minus seller discount; a
 * marketplace-funded discount is not deducted). Item shares are allocated later by
 * the catalog's SALE_SHARE rule, not here. The line is ESTIMATE / RULE at PARCEL
 * level in Turkish lira.
 */
export function estimateInternationalServiceLine(params: {
  readonly snapshot: ParcelSnapshot;
  readonly fees: TrendyolFeeParams;
}): ProfitLine | null {
  const { snapshot, fees } = params;

  if (!snapshot.isExportSale) {
    return null;
  }

  const items = activeItems(snapshot);
  if (items.length === 0) {
    return null;
  }

  let base = ZERO;
  for (const item of items) {
    base = base.add(item.saleGross);
  }

  const gross = roundMoney(base.mul(fees.internationalServiceRatePct).div(PERCENT));
  if (gross.equals(ZERO)) {
    return null;
  }

  const amount: LineMoney = {
    gross,
    vat: vatFromGross(gross, fees.internationalServiceVatRatePct),
  };

  return createProfitLine({
    type: ProfitLineType.INTERNATIONAL_SERVICE_FEE,
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount,
    vatRatePct: fees.internationalServiceVatRatePct,
    inputs: {
      base: base.toFixed(2),
      ratePct: fees.internationalServiceRatePct.toString(),
    },
    externalRecord: null,
  });
}
