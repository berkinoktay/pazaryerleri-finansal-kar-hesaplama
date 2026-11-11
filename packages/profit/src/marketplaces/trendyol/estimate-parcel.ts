import { type AllocationItemSets } from '../../core/allocation/allocation-item-sets';
import { type AllocationItem } from '../../core/allocation/allocation-weights';
import {
  activeItems,
  assertAcceptedReturns,
  assertParcelSnapshot,
  type AcceptedReturn,
  type ParcelSnapshot,
} from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import { type ProfitLine } from '../../core/profit-line';
import {
  buildSellerCostLines,
  type ItemCostInput,
} from '../../core/seller-costs/build-seller-cost-lines';
import { buildStoppageLines } from '../../tax/tr/stoppage-lines';
import { estimateInternationalServiceLine } from './estimate-export-fees';
import { estimateReturnLines } from './estimate-returns';
import { type ResolvedTrendyolCommissionRate } from './resolve-commission-rate';
import { estimateCommissionLines, estimateSaleLines } from './estimate-sale-and-commission';
import { estimateServiceFeeLine } from './estimate-service-fee';
import { estimateShippingLine } from './estimate-shipping';
import { type TrendyolParcelAttributes, type TrendyolReferenceData } from './trendyol-inputs';

/** Everything the Trendyol parcel estimate needs; the Phase 3 loader assembles it. */
export interface TrendyolEstimateInput {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly reference: TrendyolReferenceData;
  readonly costs: readonly ItemCostInput[];
  readonly acceptedReturns: readonly AcceptedReturn[];
}

/** The lines, issues and allocation item sets for one estimated parcel. */
export interface EstimateResult {
  readonly lines: readonly ProfitLine[];
  readonly issues: readonly ProfitIssue[];
  readonly allocation: AllocationItemSets;
  // The commission rate resolved for each active item (null when nothing applied). It
  // is the single source for the scenario's reported rate; the order path ignores it.
  readonly commissionByItem: ReadonlyMap<string, ResolvedTrendyolCommissionRate | null>;
}

/**
 * The Trendyol parcel estimate orchestrator. It validates the snapshot and the
 * accepted returns, and returns nothing for a cancelled parcel. Otherwise it composes
 * the sale, commission, seller cost, stoppage, service fee, shipping, international
 * service and (when a return is accepted) the return generators in a fixed order,
 * re-implementing none of their rules. Lines come in that generator order; issues are
 * merged in the order commission, costs, shipping, returns. The allocation item sets
 * carry the active items with their standalone shipping (for forward-line allocation)
 * and the returned items (for return-leg allocation).
 */
export function estimateTrendyolParcel(input: TrendyolEstimateInput): EstimateResult {
  const { snapshot, attributes, reference, costs, acceptedReturns } = input;

  assertParcelSnapshot(snapshot);
  assertAcceptedReturns(snapshot, acceptedReturns);

  // Every item of the parcel, cancelled ones included, with no standalone amount:
  // the last-resort fallback so a parcel-level actual line (a cancelled parcel's
  // cargo invoice) can still be allocated when there are no active or returned items.
  const allItems: AllocationItem[] = snapshot.items.map((item) => ({
    orderItemId: item.orderItemId,
    saleGross: item.saleGross,
    standaloneAmount: null,
  }));

  if (snapshot.isCancelled) {
    return {
      lines: [],
      issues: [],
      allocation: { activeItems: [], returnedItems: [], allItems },
      commissionByItem: new Map(),
    };
  }

  const lines: ProfitLine[] = [];

  // 1. Sale lines.
  const saleLines = estimateSaleLines(snapshot);
  lines.push(...saleLines);

  // 2. Commission lines.
  const commission = estimateCommissionLines({ snapshot, attributes, reference });
  lines.push(...commission.lines);

  // 3. Seller cost lines.
  const sellerCost = buildSellerCostLines({ snapshot, costs });
  lines.push(...sellerCost.lines);

  // 4. Stoppage lines (from the sale lines).
  const stoppageLines = buildStoppageLines({
    saleLines,
    ratePct: reference.fees.stoppageRatePct,
    isExportSale: snapshot.isExportSale,
  });
  lines.push(...stoppageLines);

  // 5. Platform service fee.
  const serviceFeeLine = estimateServiceFeeLine({ snapshot, attributes, fees: reference.fees });
  if (serviceFeeLine !== null) {
    lines.push(serviceFeeLine);
  }

  // 6. Shipping (plus the per-item standalone shipping that weights allocation).
  const shipping = estimateShippingLine({ snapshot, attributes, reference });
  if (shipping.line !== null) {
    lines.push(shipping.line);
  }

  // 7. International service fee.
  const internationalServiceLine = estimateInternationalServiceLine({
    snapshot,
    fees: reference.fees,
  });
  if (internationalServiceLine !== null) {
    lines.push(internationalServiceLine);
  }

  // 8. Return legs (only when a return is accepted).
  let returnIssues: readonly ProfitIssue[] = [];
  let returnedItems: readonly AllocationItem[] = [];
  if (acceptedReturns.length > 0) {
    const returns = estimateReturnLines({
      snapshot,
      accepted: acceptedReturns,
      commissionLines: commission.lines,
      costLines: sellerCost.lines,
      reference,
    });
    lines.push(...returns.lines);
    returnIssues = returns.issues;
    returnedItems = returns.returnedItems;
  }

  const issues: ProfitIssue[] = [...commission.issues, ...sellerCost.issues];
  issues.push(...shipping.issues);
  issues.push(...returnIssues);

  const allocationActiveItems: AllocationItem[] = activeItems(snapshot).map((item) => ({
    orderItemId: item.orderItemId,
    saleGross: item.saleGross,
    standaloneAmount: shipping.standaloneByItem.get(item.orderItemId) ?? null,
  }));

  return {
    lines,
    issues,
    allocation: { activeItems: allocationActiveItems, returnedItems, allItems },
    commissionByItem: commission.commissionByItem,
  };
}
