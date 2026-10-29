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
  InvalidParcelSnapshotError,
  type ParcelItemSnapshot,
  type ParcelSnapshot,
} from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import {
  createProfitLine,
  nativeFx,
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
  TRENDYOL_RETURN_CYCLE_CONFIRMED_TYPES,
  TRENDYOL_SALE_CYCLE_CONFIRMED_TYPES,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
} from './settlement-records';
import {
  TRENDYOL_CURRENCY,
  type TrendyolFeeParams,
  type TrendyolParcelAttributes,
} from './trendyol-inputs';

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

/** The SALE / DISCOUNT / RETURN records that bound to one order item. */
interface ItemRecordAccumulator {
  readonly sales: TrendyolSettlementRecord[];
  readonly discounts: TrendyolSettlementRecord[];
  readonly returns: TrendyolSettlementRecord[];
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
 * Builds the shared record reference for a set of contributing records: the ids
 * sorted as text join into `inputs.recordIds`, and the first id (with its raw
 * transaction type) becomes the `externalRecord`.
 */
function buildRecordReference(records: readonly TrendyolSettlementRecord[]): RecordReference {
  const sorted = [...records].sort((a, b) => compareText(a.recordId, b.recordId));
  const first = sorted[0];
  if (first === undefined) {
    throw new Error('buildRecordReference requires at least one record');
  }
  return {
    recordIds: sorted.map((record) => record.recordId).join(','),
    externalRecord: { recordId: first.recordId, rawType: first.transactionType },
  };
}

export function mapTrendyolRecords(input: TrendyolMappingInput): MappingResult {
  const { snapshot, attributes, fees, records, cargoItems, estimateLines } = input;

  if (snapshot.accountingCurrency !== TRENDYOL_CURRENCY) {
    throw new InvalidParcelSnapshotError(
      `Trendyol settlements require ${TRENDYOL_CURRENCY} accounting currency, got ${snapshot.accountingCurrency}`,
    );
  }

  const currency = snapshot.accountingCurrency;
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
    const created: ItemRecordAccumulator = { sales: [], discounts: [], returns: [] };
    accumulators.set(orderItemId, created);
    return created;
  }

  function matchActiveItemByBarcode(barcode: string | null): ParcelItemSnapshot[] {
    if (barcode === null) {
      return [];
    }
    return active.filter((item) => item.barcode === barcode);
  }

  // ── Classification (record input order) ──────────────────────────────────
  for (const record of records) {
    const kind = recordKind(record);
    switch (kind) {
      case 'SALE':
      case 'DISCOUNT':
      case 'RETURN': {
        if (kind === 'RETURN' && snapshot.isExportSale) {
          // On export the return does not reverse the sale (design §18); it only
          // joins the return cycle so its payment order can confirm export fees.
          issues.push({
            code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
            orderItemId: null,
            detail: `EXPORT_RETURN:${record.recordId}`,
          });
          if (record.paymentOrderId !== null) {
            returnCyclePaymentOrderIds.add(record.paymentOrderId);
          }
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
          if (record.paymentOrderId !== null) {
            saleCyclePaymentOrderIds.add(record.paymentOrderId);
          }
        } else if (kind === 'DISCOUNT') {
          accumulator.discounts.push(record);
        } else {
          accumulator.returns.push(record);
          if (record.paymentOrderId !== null) {
            returnCyclePaymentOrderIds.add(record.paymentOrderId);
          }
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
        fx: nativeFx(amount, currency),
        inputs: { recordIds: params.reference.recordIds },
        externalRecord: params.reference.externalRecord,
      }),
    );
  }

  // ── Per item, in snapshot order ──────────────────────────────────────────
  for (const item of active) {
    const accumulator = accumulators.get(item.orderItemId);
    if (accumulator === undefined) {
      continue;
    }
    const itemSaleVatRatePct = saleVatRatePct(item.saleVatRatePct, snapshot.isExportSale);

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
        const reference = buildRecordReference([...accumulator.sales, ...accumulator.discounts]);
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
    }

    if (accumulator.returns.length > 0) {
      const returnDebt = sumDecimals(accumulator.returns.map((record) => record.debt));
      const returnCommission = sumCommission(accumulator.returns);
      const reference = buildRecordReference(accumulator.returns);
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

  // ── Cargo invoice (cargo-item input order for issues) ─────────────────────
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
      fx: nativeFx(amount, currency),
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

  // ── Payment confirmation (two independent cycles) ─────────────────────────
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
          fx: estimate.fx,
          inputs: { ...estimate.inputs, confirmedBy: `payment-order:${paymentOrderId}` },
          externalRecord: { recordId: paymentOrder.recordId, rawType: 'PaymentOrder' },
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
