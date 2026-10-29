import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { type AllocationItem } from '../../core/allocation/allocation-weights';
import {
  activeItems,
  assertAcceptedReturns,
  type AcceptedReturn,
  type ParcelItemSnapshot,
  type ParcelSnapshot,
} from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import {
  createProfitLine,
  nativeFx,
  type LineMoney,
  type ProfitLine,
} from '../../core/profit-line';
import { buildCostReturnLines } from '../../core/seller-costs/build-cost-return-lines';
import { roundMoney } from '../../money';
import { saleVatRatePct } from '../../tax/tr/sale-vat';
import { buildStoppageRefundLines } from '../../tax/tr/stoppage-lines';
import { grossFromNet, vatFromGross } from '../../tax/tr/vat';
import { resolveTrendyolShippingNet, type ShippingTariffKind } from './estimate-shipping';
import {
  type OverseasReturnTier,
  type TrendyolReferenceData,
  type TrendyolShippingTariff,
} from './trendyol-inputs';

const ZERO = new Decimal(0);
/** Percent rates are expressed per hundred; the divisor that turns a rate into a factor. */
const PERCENT = new Decimal(100);

/** The shape every return estimator returns: lines, issues and the returned-item set. */
interface ReturnEstimate {
  readonly lines: ProfitLine[];
  readonly issues: ProfitIssue[];
  readonly returnedItems: AllocationItem[];
}

/** One accepted return paired with its snapshot item, in snapshot item order. */
interface AcceptedEntry {
  readonly item: ParcelItemSnapshot;
  readonly acceptedQuantity: number;
}

/**
 * Return estimates for one Trendyol parcel. A domestic parcel reverses the sale,
 * commission, seller cost, stoppage and return shipping for the accepted share of
 * each returned item; an export parcel reverses none of these and charges the
 * overseas return operation fee instead (the sale stays with the seller and the
 * commission is not refunded). The returned-item set drives the allocation of the
 * return legs. All amounts are in the parcel's accounting currency; the module
 * never writes a zero-amount line.
 */
export function estimateReturnLines(params: {
  readonly snapshot: ParcelSnapshot;
  readonly accepted: readonly AcceptedReturn[];
  readonly commissionLines: readonly ProfitLine[];
  readonly costLines: readonly ProfitLine[];
  readonly reference: TrendyolReferenceData;
}): {
  readonly lines: ProfitLine[];
  readonly issues: ProfitIssue[];
  readonly returnedItems: AllocationItem[];
} {
  const { snapshot, accepted, commissionLines, costLines, reference } = params;
  assertAcceptedReturns(snapshot, accepted);

  if (accepted.length === 0) {
    return { lines: [], issues: [], returnedItems: [] };
  }

  const acceptedByItem = new Map<string, number>();
  for (const entry of accepted) {
    acceptedByItem.set(entry.orderItemId, entry.acceptedQuantity);
  }

  const commissionByItem = new Map<string, ProfitLine>();
  for (const line of commissionLines) {
    if (line.type === ProfitLineType.COMMISSION && line.orderItemId !== null) {
      commissionByItem.set(line.orderItemId, line);
    }
  }

  const acceptedEntries: AcceptedEntry[] = [];
  for (const item of activeItems(snapshot)) {
    const acceptedQuantity = acceptedByItem.get(item.orderItemId);
    if (acceptedQuantity === undefined) {
      continue;
    }
    acceptedEntries.push({ item, acceptedQuantity });
  }

  if (snapshot.isExportSale) {
    return estimateExportReturns({ snapshot, acceptedEntries, commissionByItem, reference });
  }
  return estimateDomesticReturns({
    snapshot,
    acceptedEntries,
    commissionByItem,
    costLines,
    reference,
  });
}

/** The carrier code recorded on the line: the carrier for Trendyol kinds, null for OWN. */
function carrierCodeForKind(
  kind: ShippingTariffKind,
  tariff: TrendyolShippingTariff,
): string | null {
  if (kind === 'OWN') {
    return null;
  }
  return tariff.carrier === null ? null : tariff.carrier.code;
}

/**
 * The standalone (as-if-returned-alone) return shipping gross for one returned item,
 * used as an allocation weight. The desi is `unitDesi x acceptedQuantity`, the basket
 * is the item's own returned sale, and the return never uses Barem. Returns `null`
 * when the desi is unknown or the tariff cannot be resolved.
 */
function standaloneReturnShippingGross(params: {
  readonly item: ParcelItemSnapshot;
  readonly acceptedQuantity: number;
  readonly saleReturnGross: Decimal;
  readonly reference: TrendyolReferenceData;
}): Decimal | null {
  const { item, acceptedQuantity, saleReturnGross, reference } = params;
  if (item.unitDesi === null) {
    return null;
  }

  const resolved = resolveTrendyolShippingNet({
    desi: item.unitDesi.mul(acceptedQuantity),
    basketGross: saleReturnGross,
    eligibleForBarem: false,
    tariff: reference.shipping,
  });
  if (!resolved.ok) {
    return null;
  }
  return grossFromNet(resolved.net, reference.fees.returnShippingVatRatePct);
}

/** Return legs for a domestic parcel, per accepted item then the parcel return shipping. */
function estimateDomesticReturns(params: {
  readonly snapshot: ParcelSnapshot;
  readonly acceptedEntries: readonly AcceptedEntry[];
  readonly commissionByItem: ReadonlyMap<string, ProfitLine>;
  readonly costLines: readonly ProfitLine[];
  readonly reference: TrendyolReferenceData;
}): ReturnEstimate {
  const { snapshot, acceptedEntries, commissionByItem, costLines, reference } = params;

  const saleReturnLines: ProfitLine[] = [];
  const commissionRefundLines: ProfitLine[] = [];
  const ratioByItem = new Map<string, Decimal>();
  const returnedItems: AllocationItem[] = [];

  let anyDesiUnknown = false;
  let returnDesi = ZERO;
  let returnBasketGross = ZERO;

  for (const { item, acceptedQuantity } of acceptedEntries) {
    const ratio = new Decimal(acceptedQuantity).div(item.quantity);
    ratioByItem.set(item.orderItemId, ratio);

    const saleReturnGross = roundMoney(item.saleGross.mul(ratio));
    const saleVat = saleVatRatePct(item.saleVatRatePct, false);
    if (!saleReturnGross.equals(ZERO)) {
      const amount: LineMoney = {
        gross: saleReturnGross,
        vat: vatFromGross(saleReturnGross, saleVat),
      };
      saleReturnLines.push(
        createProfitLine({
          type: ProfitLineType.SALE_RETURN,
          level: ProfitLineLevel.ITEM,
          orderItemId: item.orderItemId,
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          amount,
          vatRatePct: saleVat,
          fx: nativeFx(amount, snapshot.accountingCurrency),
          inputs: {
            acceptedQuantity: acceptedQuantity.toString(),
            quantity: item.quantity.toString(),
          },
          externalRecord: null,
        }),
      );
    }
    returnBasketGross = returnBasketGross.add(saleReturnGross);

    const commissionLine = commissionByItem.get(item.orderItemId);
    if (commissionLine !== undefined) {
      const gross = roundMoney(commissionLine.amount.gross.mul(ratio));
      if (!gross.equals(ZERO)) {
        const amount: LineMoney = {
          gross,
          vat: vatFromGross(gross, reference.fees.commissionVatRatePct),
        };
        commissionRefundLines.push(
          createProfitLine({
            type: ProfitLineType.COMMISSION_REFUND,
            level: ProfitLineLevel.ITEM,
            orderItemId: item.orderItemId,
            certainty: ProfitLineCertainty.ESTIMATE,
            source: ProfitLineSource.RULE,
            amount,
            vatRatePct: reference.fees.commissionVatRatePct,
            fx: nativeFx(amount, snapshot.accountingCurrency),
            inputs: { ratio: ratio.toString() },
            externalRecord: null,
          }),
        );
      }
    }

    if (item.unitDesi === null) {
      anyDesiUnknown = true;
    } else {
      returnDesi = returnDesi.add(item.unitDesi.mul(acceptedQuantity));
    }

    returnedItems.push({
      orderItemId: item.orderItemId,
      saleGross: saleReturnGross,
      standaloneAmount: standaloneReturnShippingGross({
        item,
        acceptedQuantity,
        saleReturnGross,
        reference,
      }),
    });
  }

  const costReturnLines = buildCostReturnLines({ costLines, ratioByItem });
  const stoppageRefundLines = buildStoppageRefundLines({
    saleReturnLines,
    ratePct: reference.fees.stoppageRatePct,
    isExportSale: false,
    accountingCurrency: snapshot.accountingCurrency,
  });

  const lines: ProfitLine[] = [
    ...saleReturnLines,
    ...commissionRefundLines,
    ...costReturnLines,
    ...stoppageRefundLines,
  ];
  const issues: ProfitIssue[] = [];

  const returnShipping = buildReturnShippingLine({
    snapshot,
    anyDesiUnknown,
    desi: returnDesi,
    basketGross: returnBasketGross,
    reference,
  });
  if (returnShipping.line !== null) {
    lines.push(returnShipping.line);
  }
  if (returnShipping.issue !== null) {
    issues.push(returnShipping.issue);
  }

  return { lines, issues, returnedItems };
}

/**
 * The single parcel-level RETURN_SHIPPING line. An unknown desi on any accepted item
 * or an unresolvable tariff yields a blocking SHIPPING_ESTIMATE_UNAVAILABLE issue
 * (reason in `detail`, prefixed `RETURN_`) and no line; a zero gross yields neither.
 */
function buildReturnShippingLine(params: {
  readonly snapshot: ParcelSnapshot;
  readonly anyDesiUnknown: boolean;
  readonly desi: Decimal;
  readonly basketGross: Decimal;
  readonly reference: TrendyolReferenceData;
}): { readonly line: ProfitLine | null; readonly issue: ProfitIssue | null } {
  const { snapshot, anyDesiUnknown, desi, basketGross, reference } = params;

  if (anyDesiUnknown) {
    return {
      line: null,
      issue: {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'RETURN_UNKNOWN_DESI',
      },
    };
  }

  const resolved = resolveTrendyolShippingNet({
    desi,
    basketGross,
    eligibleForBarem: false,
    tariff: reference.shipping,
  });
  if (!resolved.ok) {
    return {
      line: null,
      issue: {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: `RETURN_${resolved.reason}`,
      },
    };
  }

  const gross = grossFromNet(resolved.net, reference.fees.returnShippingVatRatePct);
  if (gross.equals(ZERO)) {
    return { line: null, issue: null };
  }

  const amount: LineMoney = {
    gross,
    vat: vatFromGross(gross, reference.fees.returnShippingVatRatePct),
  };
  const line = createProfitLine({
    type: ProfitLineType.RETURN_SHIPPING,
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount,
    vatRatePct: reference.fees.returnShippingVatRatePct,
    fx: nativeFx(amount, snapshot.accountingCurrency),
    inputs: {
      desi: desi.toString(),
      tariffKind: resolved.kind,
      carrierCode: carrierCodeForKind(resolved.kind, reference.shipping),
    },
    externalRecord: null,
  });

  return { line, issue: null };
}

/** The overseas (micro-export) return tier whose inclusive band contains the unit sale. */
function findOverseasReturnTier(
  tiers: readonly OverseasReturnTier[],
  unitSaleGross: Decimal,
): OverseasReturnTier {
  const tier = tiers.find(
    (candidate) =>
      candidate.minUnitSaleGross.lte(unitSaleGross) &&
      unitSaleGross.lte(candidate.maxUnitSaleGross),
  );
  if (tier === undefined) {
    throw new RangeError(`no overseas return tier matches unit sale ${unitSaleGross.toString()}`);
  }
  return tier;
}

/**
 * Return legs for an export parcel. No domestic leg is written: the sale stays with
 * the seller and the commission is not refunded. Each accepted item is charged one
 * INTERNATIONAL_OPERATION_FEE: `max(0, accepted sale - accepted effective commission)`
 * times the tier rate for its rounded unit sale, rounded per item. VAT is assumed
 * zero. A fee that rounds to zero writes no line.
 */
function estimateExportReturns(params: {
  readonly snapshot: ParcelSnapshot;
  readonly acceptedEntries: readonly AcceptedEntry[];
  readonly commissionByItem: ReadonlyMap<string, ProfitLine>;
  readonly reference: TrendyolReferenceData;
}): ReturnEstimate {
  const { snapshot, acceptedEntries, commissionByItem, reference } = params;

  const lines: ProfitLine[] = [];
  const returnedItems: AllocationItem[] = [];

  for (const { item, acceptedQuantity } of acceptedEntries) {
    const ratio = new Decimal(acceptedQuantity).div(item.quantity);
    const unitSaleGross = roundMoney(item.saleGross.div(item.quantity));
    const tier = findOverseasReturnTier(reference.fees.overseasReturnTiers, unitSaleGross);

    const commissionLine = commissionByItem.get(item.orderItemId);
    const commissionGross = commissionLine === undefined ? ZERO : commissionLine.amount.gross;
    const acceptedSale = item.saleGross.mul(ratio);
    const acceptedCommission = commissionGross.mul(ratio);
    const gross = roundMoney(
      Decimal.max(ZERO, acceptedSale.sub(acceptedCommission)).mul(tier.ratePct).div(PERCENT),
    );

    if (!gross.equals(ZERO)) {
      const amount: LineMoney = { gross, vat: ZERO };
      lines.push(
        createProfitLine({
          type: ProfitLineType.INTERNATIONAL_OPERATION_FEE,
          level: ProfitLineLevel.ITEM,
          orderItemId: item.orderItemId,
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          amount,
          vatRatePct: ZERO,
          fx: nativeFx(amount, snapshot.accountingCurrency),
          inputs: { ratePct: tier.ratePct.toString(), vatAssumption: 'ZERO' },
          externalRecord: null,
        }),
      );
    }

    returnedItems.push({
      orderItemId: item.orderItemId,
      saleGross: roundMoney(item.saleGross.mul(ratio)),
      standaloneAmount: null,
    });
  }

  return { lines, issues: [], returnedItems };
}
