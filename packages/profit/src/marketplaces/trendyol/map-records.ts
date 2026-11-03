import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import {
  activeItems,
  type ParcelItemSnapshot,
  type ParcelSnapshot,
} from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import {
  createProfitLine,
  type ExternalRecordRef,
  type LineMoney,
  type ProfitLine,
} from '../../core/profit-line';
import { saleVatRatePct } from '../../tax/tr/sale-vat';
import { vatFromGross } from '../../tax/tr/vat';
import {
  recordKind,
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
  TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
  TRENDYOL_RETURN_CYCLE_CONFIRMED_TYPES,
  TRENDYOL_SALE_CYCLE_CONFIRMED_TYPES,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
} from './settlement-records';
import { type TrendyolFeeParams, type TrendyolParcelAttributes } from './trendyol-inputs';

const ZERO = new Decimal(0);

/** Input for the Trendyol settlement + cargo-invoice mapper. */
export interface TrendyolMappingInput {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly fees: TrendyolFeeParams;
  readonly records: readonly TrendyolSettlementRecord[]; // records the loader associated with this parcel
  readonly cargoItems: readonly TrendyolCargoInvoiceItem[];
  readonly estimateLines: readonly ProfitLine[]; // current estimates, for payment confirmation
}

/** Output of the mapper: actual lines, issues, and the period records set aside. */
export interface MappingResult {
  readonly lines: readonly ProfitLine[];
  readonly issues: readonly ProfitIssue[];
  readonly periodRecords: readonly TrendyolSettlementRecord[];
}

/** The SALE / DISCOUNT / RETURN / DISCOUNT_REVERSAL records that bound to one order item. */
interface ItemRecordAccumulator {
  readonly sales: TrendyolSettlementRecord[];
  readonly discounts: TrendyolSettlementRecord[];
  readonly returns: TrendyolSettlementRecord[];
  readonly discountReversals: TrendyolSettlementRecord[];
}

/** The shared reference built from the records that contribute to a line. */
interface RecordReference {
  readonly recordIds: string; // every contributing id, sorted as text, joined by ','
  readonly externalRecord: ExternalRecordRef; // the first id + its transaction type
}

/** Lexicographic comparison; the single text order used for ids and cargo keys. */
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sumDecimals(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.add(value), ZERO);
}

/** Sum of record commission amounts; a null commission counts as zero. */
function sumCommission(records: readonly TrendyolSettlementRecord[]): Decimal {
  return sumDecimals(records.map((record) => record.commissionAmount ?? ZERO));
}

function isZeroAmount(amount: LineMoney): boolean {
  return amount.gross.isZero() && amount.vat.isZero();
}

/**
 * Builds the shared record reference for a set of contributing records: every id in
 * `all` sorted as text joins into `inputs.recordIds`, and the first id of `primary`
 * (sorted as text, with its raw transaction type) becomes the `externalRecord`. The
 * sale/commission lines pass the Sale records as `primary`, so the external record
 * points at a Sale and never at a Discount; return lines pass their Return records.
 */
function buildRecordReference(params: {
  readonly all: readonly TrendyolSettlementRecord[];
  readonly primary: readonly TrendyolSettlementRecord[];
}): RecordReference {
  const sortedAll = [...params.all].sort((a, b) => compareText(a.recordId, b.recordId));
  const sortedPrimary = [...params.primary].sort((a, b) => compareText(a.recordId, b.recordId));
  const first = sortedPrimary[0];
  if (first === undefined) {
    throw new Error('buildRecordReference requires at least one primary record');
  }
  return {
    recordIds: sortedAll.map((record) => record.recordId).join(','),
    externalRecord: { recordId: first.recordId, rawType: first.transactionType },
  };
}

export function mapTrendyolRecords(input: TrendyolMappingInput): MappingResult {
  const { snapshot, attributes, fees, records, cargoItems, estimateLines } = input;

  const active = activeItems(snapshot);

  const lines: ProfitLine[] = [];
  const issues: ProfitIssue[] = [];
  const periodRecords: TrendyolSettlementRecord[] = [];

  const accumulators = new Map<string, ItemRecordAccumulator>();
  const paymentOrders = new Map<string, TrendyolSettlementRecord>();
  const saleCyclePaymentOrderIds = new Set<string>();
  const returnCyclePaymentOrderIds = new Set<string>();

  function accumulatorFor(orderItemId: string): ItemRecordAccumulator {
    const existing = accumulators.get(orderItemId);
    if (existing !== undefined) {
      return existing;
    }
    const created: ItemRecordAccumulator = {
      sales: [],
      discounts: [],
      returns: [],
      discountReversals: [],
    };
    accumulators.set(orderItemId, created);
    return created;
  }

  function matchActiveItemByBarcode(barcode: string | null): ParcelItemSnapshot[] {
    if (barcode === null) {
      return [];
    }
    return active.filter((item) => item.barcode === barcode);
  }

  // -- Classification (record input order) --
  for (const record of records) {
    const kind = recordKind(record);
    switch (kind) {
      case 'SALE':
      case 'DISCOUNT':
      case 'RETURN':
      case 'DISCOUNT_REVERSAL': {
        // Cycle ids come from every Sale and Return record of the parcel, bound or
        // not: an unbound record (no item or several items) still joins its payment
        // cycle so its payment order can confirm the cycle's estimates. A DISCOUNT or
        // DISCOUNT_REVERSAL adds no cycle id (it rides the sale/return it belongs to).
        if (record.paymentOrderId !== null) {
          if (kind === 'SALE') {
            saleCyclePaymentOrderIds.add(record.paymentOrderId);
          } else if (kind === 'RETURN') {
            returnCyclePaymentOrderIds.add(record.paymentOrderId);
          }
        }

        if ((kind === 'RETURN' || kind === 'DISCOUNT_REVERSAL') && snapshot.isExportSale) {
          // On export the return does not reverse the sale (design section 18), and a
          // reversal is treated the same way: it only joins the return cycle (above) so
          // its payment order can confirm the export fees, never netting a line.
          issues.push({
            code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
            orderItemId: null,
            detail: `EXPORT_RETURN:${record.recordId}`,
          });
          break;
        }

        const matches = matchActiveItemByBarcode(record.barcode);
        if (matches.length === 0) {
          issues.push({
            code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
            orderItemId: null,
            detail: `NO_ITEM:${record.recordId}`,
          });
          break;
        }
        if (matches.length > 1) {
          issues.push({
            code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
            orderItemId: null,
            detail: `MULTIPLE_ITEMS:${record.recordId}`,
          });
          break;
        }
        const matched = matches[0];
        if (matched === undefined) {
          break;
        }
        const accumulator = accumulatorFor(matched.orderItemId);
        if (kind === 'SALE') {
          accumulator.sales.push(record);
        } else if (kind === 'DISCOUNT') {
          accumulator.discounts.push(record);
        } else if (kind === 'RETURN') {
          accumulator.returns.push(record);
        } else {
          accumulator.discountReversals.push(record);
        }
        break;
      }
      case 'PAYMENT_ORDER': {
        if (record.paymentOrderId !== null) {
          const existing = paymentOrders.get(record.paymentOrderId);
          if (existing === undefined || compareText(record.recordId, existing.recordId) < 0) {
            paymentOrders.set(record.paymentOrderId, record);
          }
        }
        break;
      }
      case 'PERIOD': {
        periodRecords.push(record);
        break;
      }
      case 'IGNORED': {
        break;
      }
      case 'UNVERIFIED': {
        issues.push({
          code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
          orderItemId: null,
          detail: `${record.transactionType}:${record.recordId}`,
        });
        break;
      }
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unhandled Trendyol record kind: ${String(exhaustive)}`);
      }
    }
  }

  function addRecordLine(params: {
    readonly type: ProfitLineType;
    readonly orderItemId: string;
    readonly gross: Decimal;
    readonly vatRatePct: Decimal;
    readonly reference: RecordReference;
  }): void {
    const amount: LineMoney = {
      gross: params.gross,
      vat: vatFromGross(params.gross, params.vatRatePct),
    };
    if (isZeroAmount(amount)) {
      return;
    }
    lines.push(
      createProfitLine({
        type: params.type,
        level: ProfitLineLevel.ITEM,
        orderItemId: params.orderItemId,
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.MARKETPLACE_RECORD,
        amount,
        vatRatePct: params.vatRatePct,
        inputs: { recordIds: params.reference.recordIds },
        externalRecord: params.reference.externalRecord,
      }),
    );
  }

  // -- Per item, in snapshot order --
  for (const item of active) {
    const accumulator = accumulators.get(item.orderItemId);
    if (accumulator === undefined) {
      continue;
    }
    const itemSaleVatRatePct = saleVatRatePct(item.saleVatRatePct, snapshot.isExportSale);

    const hasReturns = accumulator.returns.length > 0;
    const hasReversals = accumulator.discountReversals.length > 0;

    // A cancelled item keeps a discount and its reversal but no sale and no return. When
    // the reversal gives the discount back exactly (debt == credit and commission ==
    // commission) the pair leaves no trace: nothing is produced and the
    // discount-without-sale warning below is suppressed.
    const reversalsCancelDiscounts =
      !hasReturns &&
      hasReversals &&
      accumulator.sales.length === 0 &&
      sumDecimals(accumulator.discounts.map((record) => record.debt)).equals(
        sumDecimals(accumulator.discountReversals.map((record) => record.credit)),
      ) &&
      sumCommission(accumulator.discounts).equals(sumCommission(accumulator.discountReversals));

    if (accumulator.sales.length > 0) {
      const saleNet = sumDecimals(accumulator.sales.map((record) => record.credit)).sub(
        sumDecimals(accumulator.discounts.map((record) => record.debt)),
      );
      const commissionNet = sumCommission(accumulator.sales).sub(
        sumCommission(accumulator.discounts),
      );
      if (saleNet.lt(ZERO) || commissionNet.lt(ZERO)) {
        issues.push({
          code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
          orderItemId: item.orderItemId,
          detail: `NEGATIVE_NET:${item.orderItemId}`,
        });
      } else {
        const reference = buildRecordReference({
          all: [...accumulator.sales, ...accumulator.discounts],
          primary: accumulator.sales,
        });
        if (saleNet.gt(ZERO)) {
          addRecordLine({
            type: ProfitLineType.SALE,
            orderItemId: item.orderItemId,
            gross: saleNet,
            vatRatePct: itemSaleVatRatePct,
            reference,
          });
        }
        if (commissionNet.gt(ZERO)) {
          addRecordLine({
            type: ProfitLineType.COMMISSION,
            orderItemId: item.orderItemId,
            gross: commissionNet,
            vatRatePct: fees.commissionVatRatePct,
            reference,
          });
        }
      }
    } else if (accumulator.discounts.length > 0 && !reversalsCancelDiscounts) {
      // A discount bound to an item with no sale cannot net against anything; it
      // must not vanish silently. (It is suppressed only when a reversal gives it
      // back exactly on a cancelled item, handled by reversalsCancelDiscounts.)
      const sortedDiscounts = [...accumulator.discounts].sort((a, b) =>
        compareText(a.recordId, b.recordId),
      );
      const firstDiscount = sortedDiscounts[0];
      if (firstDiscount !== undefined) {
        issues.push({
          code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
          orderItemId: item.orderItemId,
          detail: `DISCOUNT_WITHOUT_SALE:${firstDiscount.recordId}`,
        });
      }
    }

    // A reversal nets only against a return (below). With no return it cannot net: unless
    // the whole item was cancelled (reversalsCancelDiscounts), each reversal record is
    // flagged so it does not vanish silently. The item's sale/discount handling above is
    // left exactly as today.
    if (!hasReturns && hasReversals && !reversalsCancelDiscounts) {
      for (const reversal of accumulator.discountReversals) {
        issues.push({
          code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
          orderItemId: item.orderItemId,
          detail: `UNMATCHED_DISCOUNT_REVERSAL:${reversal.recordId}`,
        });
      }
    }

    if (hasReturns) {
      // A reversal gives the discount/coupon back on the return, so the net return is the
      // return debt minus the reversal credit (commission likewise).
      const returnDebt = sumDecimals(accumulator.returns.map((record) => record.debt)).sub(
        sumDecimals(accumulator.discountReversals.map((record) => record.credit)),
      );
      const returnCommission = sumCommission(accumulator.returns).sub(
        sumCommission(accumulator.discountReversals),
      );
      if (returnDebt.lt(ZERO) || returnCommission.lt(ZERO)) {
        issues.push({
          code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
          orderItemId: item.orderItemId,
          detail: `NEGATIVE_NET:${item.orderItemId}`,
        });
      } else {
        const reference = buildRecordReference({
          all: [...accumulator.returns, ...accumulator.discountReversals],
          primary: accumulator.returns,
        });
        if (returnDebt.gt(ZERO)) {
          addRecordLine({
            type: ProfitLineType.SALE_RETURN,
            orderItemId: item.orderItemId,
            gross: returnDebt,
            vatRatePct: itemSaleVatRatePct,
            reference,
          });
        }
        if (returnCommission.gt(ZERO)) {
          addRecordLine({
            type: ProfitLineType.COMMISSION_REFUND,
            orderItemId: item.orderItemId,
            gross: returnCommission,
            vatRatePct: fees.commissionVatRatePct,
            reference,
          });
        }
      }
    }
  }

  // -- Cargo invoice (cargo-item input order for issues) --
  const outboundCargo: TrendyolCargoInvoiceItem[] = [];
  const returnCargo: TrendyolCargoInvoiceItem[] = [];
  for (const cargoItem of cargoItems) {
    if (cargoItem.itemType === TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE) {
      outboundCargo.push(cargoItem);
    } else if (cargoItem.itemType === TRENDYOL_CARGO_RETURN_ITEM_TYPE) {
      returnCargo.push(cargoItem);
    } else {
      issues.push({
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: `CARGO_ITEM:${cargoItem.itemType}:${cargoItem.invoiceSerial}`,
      });
    }
  }

  function buildCargoLine(
    type: ProfitLineType,
    cargoGroup: readonly TrendyolCargoInvoiceItem[],
    vatRatePct: Decimal,
  ): ProfitLine | null {
    if (cargoGroup.length === 0) {
      return null;
    }
    const gross = sumDecimals(cargoGroup.map((cargoItem) => cargoItem.amountGross));
    const amount: LineMoney = { gross, vat: vatFromGross(gross, vatRatePct) };
    if (isZeroAmount(amount)) {
      return null;
    }
    const sortedByKey = [...cargoGroup]
      .map((cargoItem) => ({
        key: `${cargoItem.invoiceSerial}:${cargoItem.parcelUniqueId}`,
        cargoItem,
      }))
      .sort((a, b) => compareText(a.key, b.key));
    const first = sortedByKey[0];
    if (first === undefined) {
      throw new Error('buildCargoLine requires at least one cargo item');
    }
    const invoiceSerials = [...new Set(cargoGroup.map((cargoItem) => cargoItem.invoiceSerial))]
      .sort(compareText)
      .join(',');
    const desiValues = cargoGroup
      .map((cargoItem) => cargoItem.desi)
      .filter((desi): desi is Decimal => desi !== null);
    const desi = desiValues.length === 0 ? null : sumDecimals(desiValues).toString();
    return createProfitLine({
      type,
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.CARGO_INVOICE,
      amount,
      vatRatePct,
      inputs: { invoiceSerials, desi },
      externalRecord: { recordId: first.key, rawType: first.cargoItem.itemType },
    });
  }

  let cargoShippingProduced = false;
  let cargoReturnShippingProduced = false;

  const shippingLine = buildCargoLine(
    ProfitLineType.SHIPPING,
    outboundCargo,
    fees.shippingVatRatePct,
  );
  if (shippingLine !== null) {
    lines.push(shippingLine);
    cargoShippingProduced = true;
  }
  const returnShippingLine = buildCargoLine(
    ProfitLineType.RETURN_SHIPPING,
    returnCargo,
    fees.returnShippingVatRatePct,
  );
  if (returnShippingLine !== null) {
    lines.push(returnShippingLine);
    cargoReturnShippingProduced = true;
  }

  // -- Payment confirmation (two independent cycles) --
  function smallestConfirmedCyclePaymentOrderId(cycleIds: ReadonlySet<string>): string | null {
    let smallest: string | null = null;
    for (const id of cycleIds) {
      if (!paymentOrders.has(id)) {
        continue;
      }
      if (smallest === null || compareText(id, smallest) < 0) {
        smallest = id;
      }
    }
    return smallest;
  }

  function confirmCycle(
    cycleIds: ReadonlySet<string>,
    confirmedTypes: ReadonlySet<ProfitLineType>,
  ): void {
    const paymentOrderId = smallestConfirmedCyclePaymentOrderId(cycleIds);
    if (paymentOrderId === null) {
      return;
    }
    const paymentOrder = paymentOrders.get(paymentOrderId);
    if (paymentOrder === undefined) {
      return;
    }
    for (const estimate of estimateLines) {
      if (estimate.certainty !== ProfitLineCertainty.ESTIMATE) {
        continue;
      }
      if (!confirmedTypes.has(estimate.type)) {
        continue;
      }
      lines.push(
        createProfitLine({
          type: estimate.type,
          level: estimate.level,
          orderItemId: estimate.orderItemId,
          certainty: ProfitLineCertainty.ACTUAL,
          source: ProfitLineSource.MARKETPLACE_RECORD,
          amount: estimate.amount,
          vatRatePct: estimate.vatRatePct,
          inputs: { ...estimate.inputs, confirmedBy: `payment-order:${paymentOrderId}` },
          externalRecord: {
            recordId: paymentOrder.recordId,
            rawType: TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
          },
        }),
      );
    }
  }

  const saleConfirmedTypes = new Set<ProfitLineType>(TRENDYOL_SALE_CYCLE_CONFIRMED_TYPES);
  if (attributes.usesSellerCargoAgreement && !cargoShippingProduced) {
    saleConfirmedTypes.add(ProfitLineType.SHIPPING);
  }
  confirmCycle(saleCyclePaymentOrderIds, saleConfirmedTypes);

  const returnConfirmedTypes = new Set<ProfitLineType>(TRENDYOL_RETURN_CYCLE_CONFIRMED_TYPES);
  if (attributes.usesSellerCargoAgreement && !cargoReturnShippingProduced) {
    returnConfirmedTypes.add(ProfitLineType.RETURN_SHIPPING);
  }
  confirmCycle(returnCyclePaymentOrderIds, returnConfirmedTypes);

  return { lines, issues, periodRecords };
}
