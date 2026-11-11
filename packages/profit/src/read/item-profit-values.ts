import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { getLineSpec } from '../core/catalog/profit-line-catalog';
import { type ProfitIssue } from '../core/profit-issue';
import { type ProfitLine } from '../core/profit-line';
import { roundMoney } from '../money';

const ZERO = new Decimal(0);

/** A zero money amount in the two-decimal wire shape the per-item figures use. */
const ZERO_AMOUNT = '0.00';

/**
 * The per-item cost and commission figures the order detail shows for one line. Unit
 * cost and its VAT rate come from the item's best-known cost lines; the commission
 * amount from the best-known commission line, the rate and its VAT rate from the
 * estimate commission line that carries the rate; the settled commission is set only
 * when the best-known commission came from a marketplace record.
 * The refunded commission is the item's best-known COMMISSION_REFUND lines (a returned
 * item's commission given back), read the same way the commission is.
 *
 * A missing commission reads like a missing cost: while a MISSING_COMMISSION_RATE issue
 * covers the item and the view has no commission line for it, the commission amount and
 * the refunded commission are null (unknown), not a fabricated zero. A commission line
 * (a settlement actual included) always wins over the issue; with neither a line nor the
 * issue the two amounts are "0.00" (a cancelled order, an item that was not returned).
 * The estimated and settled commissions stay null whenever their view has no line.
 */
export interface ItemProfitValues {
  readonly unitCostGross: string | null;
  readonly unitCostVatRate: string | null;
  readonly commissionGross: string | null;
  readonly commissionRate: string | null;
  readonly commissionVatRate: string | null;
  readonly estimatedCommissionGross: string | null;
  readonly settledCommissionGross: string | null;
  readonly refundedCommissionGross: string | null;
}

/**
 * Derives one order item's cost and commission values from its already view-selected
 * profit lines (callers run `selectLines`). `bestKnownLines` and `estimateLines` are
 * the two views' lines; `issues` are the statement's issues. All amounts are decimal
 * strings; a missing figure is null.
 */
export function itemProfitValues(input: {
  readonly orderItemId: string;
  readonly quantity: number;
  readonly bestKnownLines: readonly ProfitLine[];
  readonly estimateLines: readonly ProfitLine[];
  readonly issues: readonly ProfitIssue[];
}): ItemProfitValues {
  const { orderItemId, quantity, bestKnownLines, estimateLines, issues } = input;

  const bestKnownForItem = bestKnownLines.filter((line) => line.orderItemId === orderItemId);
  const estimateForItem = estimateLines.filter((line) => line.orderItemId === orderItemId);
  const rateSource = rateCarryingCommissionLine(estimateForItem);
  const bestKnownCommission = commissionGrossOf(bestKnownForItem);
  // The best-known commission is unknown -- not zero -- when no line supplies it and a
  // blocking MISSING_COMMISSION_RATE issue covers the item.
  const commissionUnknown =
    bestKnownCommission === null && hasMissingCommissionRate(issues, orderItemId);

  return {
    unitCostGross: unitCostGrossOf(bestKnownForItem, orderItemId, quantity, issues),
    unitCostVatRate: sharedCostVatRate(bestKnownForItem),
    commissionGross: commissionUnknown ? null : (bestKnownCommission ?? ZERO_AMOUNT),
    commissionRate: rateSource?.ratePct ?? null,
    commissionVatRate: rateSource?.line.vatRatePct?.toString() ?? null,
    // Null when the estimate view has no commission line, which includes every item a
    // MISSING_COMMISSION_RATE issue covers (the engine writes no line for it).
    estimatedCommissionGross: commissionGrossOf(estimateForItem),
    settledCommissionGross: settledCommissionGrossOf(bestKnownForItem),
    refundedCommissionGross: refundedCommissionGrossOf(
      bestKnownForItem,
      commissionUnknown && hasAcceptedReturn(bestKnownForItem),
    ),
  };
}

/** True when the best-known view carries a sale-return line for the item (an accepted return). */
function hasAcceptedReturn(lines: readonly ProfitLine[]): boolean {
  return lines.some((line) => line.type === ProfitLineType.SALE_RETURN);
}

/** The item's product-cost expense lines (COST_* without COST_RETURN), by catalog spec. */
function costExpenseLines(lines: readonly ProfitLine[]): ProfitLine[] {
  return lines.filter((line) => {
    const spec = getLineSpec(line.type);
    return spec.group === 'PRODUCT_COST' && spec.direction === 'EXPENSE';
  });
}

/**
 * True when an issue of `code` applies to this item: one that names the item, or a
 * parcel-wide issue (`orderItemId` null) that covers every item.
 */
function hasIssueForItem(
  issues: readonly ProfitIssue[],
  code: ProfitIssueCode,
  orderItemId: string,
): boolean {
  return issues.some(
    (issue) =>
      issue.code === code && (issue.orderItemId === null || issue.orderItemId === orderItemId),
  );
}

/** True when a blocking MISSING_COST issue covers this item. */
function hasMissingCost(issues: readonly ProfitIssue[], orderItemId: string): boolean {
  return hasIssueForItem(issues, ProfitIssueCode.MISSING_COST, orderItemId);
}

/** True when a blocking MISSING_COMMISSION_RATE issue covers this item. */
function hasMissingCommissionRate(issues: readonly ProfitIssue[], orderItemId: string): boolean {
  return hasIssueForItem(issues, ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId);
}

/**
 * Unit cost: null when a MISSING_COST issue covers the item; "0.00" when the item has no
 * cost line; otherwise the item's cost lines summed and divided by the quantity (two
 * decimals, half-up). A non-positive quantity yields null -- there is no unit to divide
 * into.
 */
function unitCostGrossOf(
  lines: readonly ProfitLine[],
  orderItemId: string,
  quantity: number,
  issues: readonly ProfitIssue[],
): string | null {
  if (hasMissingCost(issues, orderItemId)) {
    return null;
  }
  const costLines = costExpenseLines(lines);
  if (costLines.length === 0) {
    return '0.00';
  }
  if (quantity <= 0) {
    return null;
  }
  const total = costLines.reduce((sum, line) => sum.add(line.amount.gross), ZERO);
  return roundMoney(total.div(quantity)).toFixed(2);
}

/** The VAT rate shared by every cost line as a string; null when none or they differ. */
function sharedCostVatRate(lines: readonly ProfitLine[]): string | null {
  const costLines = costExpenseLines(lines);
  let shared: string | null = null;
  let seen = false;
  for (const line of costLines) {
    const rate = line.vatRatePct === null ? null : line.vatRatePct.toFixed();
    if (!seen) {
      shared = rate;
      seen = true;
    } else if (shared !== rate) {
      return null;
    }
  }
  return seen ? shared : null;
}

/** The item's commission line(s) gross summed as a string; null when there is none. */
function commissionGrossOf(lines: readonly ProfitLine[]): string | null {
  const commissionLines = lines.filter((line) => line.type === ProfitLineType.COMMISSION);
  if (commissionLines.length === 0) {
    return null;
  }
  return commissionLines.reduce((sum, line) => sum.add(line.amount.gross), ZERO).toFixed(2);
}

/**
 * The first estimate commission line carrying a string `ratePct` input, with that rate;
 * null when there is none. The item's commission rate and commission VAT rate both come
 * from this one line.
 */
function rateCarryingCommissionLine(
  estimateLines: readonly ProfitLine[],
): { readonly ratePct: string; readonly line: ProfitLine } | null {
  for (const line of estimateLines) {
    if (line.type !== ProfitLineType.COMMISSION) {
      continue;
    }
    const rate = line.inputs['ratePct'];
    if (typeof rate === 'string') {
      return { ratePct: rate, line };
    }
  }
  return null;
}

/** The best-known commission gross only when it is an actual from a marketplace record. */
function settledCommissionGrossOf(lines: readonly ProfitLine[]): string | null {
  const settled = lines.filter(
    (line) =>
      line.type === ProfitLineType.COMMISSION &&
      line.certainty === ProfitLineCertainty.ACTUAL &&
      line.source === ProfitLineSource.MARKETPLACE_RECORD,
  );
  if (settled.length === 0) {
    return null;
  }
  return settled.reduce((sum, line) => sum.add(line.amount.gross), ZERO).toFixed(2);
}

/**
 * The item's commission refund line(s) gross summed as a string. With no refund line it is
 * null only when a refund is actually owed but cannot be known: the item was returned and
 * its commission is unknown (no rate, so the engine wrote no refund line either). An item
 * that was not returned has nothing to give back, so it is "0.00" even when its commission
 * is unknown.
 */
function refundedCommissionGrossOf(
  lines: readonly ProfitLine[],
  refundUnknown: boolean,
): string | null {
  const refundLines = lines.filter((line) => line.type === ProfitLineType.COMMISSION_REFUND);
  if (refundLines.length === 0) {
    return refundUnknown ? null : ZERO_AMOUNT;
  }
  return refundLines.reduce((sum, line) => sum.add(line.amount.gross), ZERO).toFixed(2);
}
