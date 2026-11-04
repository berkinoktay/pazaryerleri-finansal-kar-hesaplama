import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { activeItems, type ParcelSnapshot } from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';
import { roundMoney } from '../../money';
import { saleVatRatePct } from '../../tax/tr/sale-vat';
import { vatFromGross } from '../../tax/tr/vat';
import {
  resolveTrendyolCommissionRate,
  type ResolvedTrendyolCommissionRate,
} from './resolve-commission-rate';
import {
  type TrendyolItemAttributes,
  type TrendyolParcelAttributes,
  type TrendyolReferenceData,
} from './trendyol-inputs';

const ZERO = new Decimal(0);
/** Percent rates are expressed per hundred; the divisor that turns a rate into a factor. */
const PERCENT = new Decimal(100);

/**
 * One SALE (ITEM) line per active item. The gross is the seller's sale amount; the
 * VAT follows the Turkish export rule (0% on an export sale). A zero sale writes no
 * line. Lines are ESTIMATE / RULE in Turkish lira.
 */
export function estimateSaleLines(snapshot: ParcelSnapshot): ProfitLine[] {
  const lines: ProfitLine[] = [];
  for (const item of activeItems(snapshot)) {
    if (item.saleGross.equals(ZERO)) {
      continue;
    }
    const vatRatePct = saleVatRatePct(item.saleVatRatePct, snapshot.isExportSale);
    const amount: LineMoney = {
      gross: item.saleGross,
      vat: vatFromGross(item.saleGross, vatRatePct),
    };
    lines.push(
      createProfitLine({
        type: ProfitLineType.SALE,
        level: ProfitLineLevel.ITEM,
        orderItemId: item.orderItemId,
        certainty: ProfitLineCertainty.ESTIMATE,
        source: ProfitLineSource.RULE,
        amount,
        vatRatePct,
        inputs: {
          listGross: item.listGross.toFixed(2),
          sellerDiscountGross: item.sellerDiscountGross.toFixed(2),
        },
        externalRecord: null,
      }),
    );
  }
  return lines;
}

/**
 * One COMMISSION (ITEM) line per active item, rounded in two steps like the
 * settlement (plan decision 12): the list and the seller-discount commissions are
 * each rounded to kurus and then subtracted. An item with no attributes or no
 * resolvable rate produces a blocking MISSING_COMMISSION_RATE issue and no line; a
 * commission that nets to zero produces neither a line nor an issue.
 *
 * `commissionByItem` records the rate resolved for each item that had attributes
 * (null when nothing applied), so a caller can report the rate even when it nets to
 * zero and carries no line, without resolving the chain a second time.
 */
export function estimateCommissionLines(params: {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly reference: TrendyolReferenceData;
}): {
  readonly lines: ProfitLine[];
  readonly issues: ProfitIssue[];
  readonly commissionByItem: ReadonlyMap<string, ResolvedTrendyolCommissionRate | null>;
} {
  const { snapshot, attributes, reference } = params;

  const attributesByItem = new Map<string, TrendyolItemAttributes>();
  for (const itemAttributes of attributes.items) {
    attributesByItem.set(itemAttributes.orderItemId, itemAttributes);
  }

  const lines: ProfitLine[] = [];
  const issues: ProfitIssue[] = [];
  const commissionByItem = new Map<string, ResolvedTrendyolCommissionRate | null>();

  for (const item of activeItems(snapshot)) {
    const itemAttributes = attributesByItem.get(item.orderItemId);
    if (itemAttributes === undefined) {
      issues.push({
        code: ProfitIssueCode.MISSING_COMMISSION_RATE,
        orderItemId: item.orderItemId,
        detail: 'NO_ATTRIBUTES',
      });
      continue;
    }

    const unitCommissionBase = roundMoney(item.saleGross.div(item.quantity));
    const resolved = resolveTrendyolCommissionRate({
      item: itemAttributes,
      unitCommissionBase,
      rules: reference.commission,
    });
    commissionByItem.set(item.orderItemId, resolved);
    if (resolved === null) {
      issues.push({
        code: ProfitIssueCode.MISSING_COMMISSION_RATE,
        orderItemId: item.orderItemId,
        detail: null,
      });
      continue;
    }

    const listCommission = roundMoney(item.listGross.mul(resolved.ratePct).div(PERCENT));
    const discountCommission = roundMoney(
      item.sellerDiscountGross.mul(resolved.ratePct).div(PERCENT),
    );
    const gross = listCommission.sub(discountCommission);
    if (gross.equals(ZERO)) {
      continue;
    }

    const amount: LineMoney = {
      gross,
      vat: vatFromGross(gross, reference.fees.commissionVatRatePct),
    };
    lines.push(
      createProfitLine({
        type: ProfitLineType.COMMISSION,
        level: ProfitLineLevel.ITEM,
        orderItemId: item.orderItemId,
        certainty: ProfitLineCertainty.ESTIMATE,
        source: ProfitLineSource.RULE,
        amount,
        vatRatePct: reference.fees.commissionVatRatePct,
        inputs: {
          ratePct: resolved.ratePct.toString(),
          rateSource: resolved.source,
          listCommission: listCommission.toFixed(2),
          discountCommission: discountCommission.toFixed(2),
        },
        externalRecord: null,
      }),
    );
  }

  return { lines, issues, commissionByItem };
}
