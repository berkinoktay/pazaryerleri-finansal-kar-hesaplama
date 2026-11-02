import { Decimal } from 'decimal.js';
import { CostProfileType, ProfitLineType, ProfitStatus } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  makeTrendyolItemAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import { allocateParcelLine } from '../../../core/allocation/allocate-parcel-line';
import { itemsForAllocation } from '../../../core/allocation/allocation-item-sets';
import { type ParcelSnapshot } from '../../../core/parcel-snapshot';
import { computeProfitStatement } from '../../../core/profit-statement';
import { type ProfitLine } from '../../../core/profit-line';
import { type ItemCostInput } from '../../../core/seller-costs/build-seller-cost-lines';
import { estimateTrendyolParcel } from '../estimate-parcel';
import { mapTrendyolRecords } from '../map-records';
import {
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
  type TrendyolTransactionType,
} from '../settlement-records';
import { type TrendyolReferenceData } from '../trendyol-inputs';

/**
 * The real, kurus-closing melontik order 11761487239, driven end to end through the
 * Trendyol module: `estimateTrendyolParcel` builds the estimate lines, the statement
 * ties them to 191.79 net profit, the shipping line allocates evenly across the two
 * items, and `mapTrendyolRecords` reconciles the sale cycle into actuals that still
 * land on 191.79 as the order moves ESTIMATED -> PARTIALLY_SETTLED -> SETTLED.
 */

const INCLUDE_NEGATIVE = { includeStopaj: true, includeNegativeNetVat: true };
const CLAMP_NEGATIVE = { includeStopaj: true, includeNegativeNetVat: false };

/** One COGS profile for one item, effective well before the order date, VAT 10%. */
function tryCogs(orderItemId: string, amountGross: string): ItemCostInput {
  return {
    orderItemId,
    profiles: [
      {
        profileId: `cogs-${orderItemId}`,
        profileType: CostProfileType.COGS,
        versions: [
          {
            effectiveFrom: new Date('2026-01-01T00:00:00Z'),
            versionNumber: 1,
            amountGross: new Decimal(amountGross),
            vatRatePct: new Decimal('10'),
            archivedAt: null,
          },
        ],
      },
    ],
  };
}

/** The melontik parcel: two items, sale VAT 10%, desi 1 each, barcodes bc-a / bc-b. */
function melontikSnapshot(): ParcelSnapshot {
  return makeParcel({
    items: [
      makeItem({
        orderItemId: 'a',
        listGross: '529.00',
        sellerDiscountGross: '37.72',
        saleVatRatePct: '10',
        unitDesi: '1',
      }),
      makeItem({
        orderItemId: 'b',
        listGross: '409.68',
        sellerDiscountGross: '29.21',
        saleVatRatePct: '10',
        unitDesi: '1',
      }),
    ],
  });
}

/**
 * The fixture reference with the desi tariff keys '1' and '2' set to 81.95 (the other
 * keys kept): the parcel desi (2) and each item's standalone desi (1) both cost 98.34.
 */
function melontikReference(): TrendyolReferenceData {
  const base = trendyolReference();
  const desiTariffNet = new Map(base.shipping.desiTariffNet);
  desiTariffNet.set('1', new Decimal('81.95'));
  desiTariffNet.set('2', new Decimal('81.95'));
  return trendyolReference({ shipping: { desiTariffNet } });
}

function melontikAttributes(): ReturnType<typeof makeTrendyolAttributes> {
  return makeTrendyolAttributes({
    fastDelivery: false,
    fastDeliveryType: null,
    actualShipDate: null,
    items: [
      makeTrendyolItemAttributes({ orderItemId: 'a', orderCommissionRatePct: '19' }),
      makeTrendyolItemAttributes({ orderItemId: 'b', orderCommissionRatePct: '19' }),
    ],
  });
}

/** Local record builder: money fields are text and converted to Decimal. */
interface MakeRecordParams {
  readonly recordId: string;
  readonly transactionType: TrendyolTransactionType;
  readonly barcode?: string | null;
  readonly debt?: string;
  readonly credit?: string;
  readonly commissionAmount?: string | null;
  readonly paymentOrderId?: string | null;
}

function makeRecord(params: MakeRecordParams): TrendyolSettlementRecord {
  return {
    recordId: params.recordId,
    transactionType: params.transactionType,
    barcode: params.barcode === undefined ? null : params.barcode,
    debt: new Decimal(params.debt ?? '0'),
    credit: new Decimal(params.credit ?? '0'),
    commissionAmount:
      params.commissionAmount === undefined || params.commissionAmount === null
        ? null
        : new Decimal(params.commissionAmount),
    paymentOrderId: params.paymentOrderId === undefined ? null : params.paymentOrderId,
  };
}

/** The melontik settlement records: a sale and a seller discount per item, one payment order. */
function melontikRecords(): TrendyolSettlementRecord[] {
  return [
    makeRecord({
      recordId: 'sale-a',
      transactionType: 'Sale',
      barcode: 'bc-a',
      credit: '529.00',
      commissionAmount: '100.51',
      paymentOrderId: '58450612',
    }),
    makeRecord({
      recordId: 'disc-a',
      transactionType: 'Discount',
      barcode: 'bc-a',
      debt: '37.72',
      commissionAmount: '7.17',
    }),
    makeRecord({
      recordId: 'sale-b',
      transactionType: 'Sale',
      barcode: 'bc-b',
      credit: '409.68',
      commissionAmount: '77.84',
      paymentOrderId: '58450612',
    }),
    makeRecord({
      recordId: 'disc-b',
      transactionType: 'Discount',
      barcode: 'bc-b',
      debt: '29.21',
      commissionAmount: '5.55',
    }),
    makeRecord({
      recordId: 'po-1',
      transactionType: 'PaymentOrder',
      paymentOrderId: '58450612',
    }),
  ];
}

function outboundCargoItem(): TrendyolCargoInvoiceItem {
  return {
    invoiceSerial: 'INV1',
    parcelUniqueId: 'P1',
    itemType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
    amountGross: new Decimal('98.34'),
    desi: new Decimal('2'),
  };
}

/** Finds the single line of a type and (for item lines) its order item; throws when absent. */
function requireLine(
  lines: readonly ProfitLine[],
  type: ProfitLineType,
  orderItemId: string | null,
): ProfitLine {
  const line = lines.find(
    (candidate) => candidate.type === type && candidate.orderItemId === orderItemId,
  );
  if (line === undefined) {
    throw new Error(`missing ${type} line for order item ${String(orderItemId)}`);
  }
  return line;
}

describe('golden: melontik parcel 11761487239 through the trendyol module', () => {
  it('estimates every line to the kurus', () => {
    const result = estimateTrendyolParcel({
      snapshot: melontikSnapshot(),
      attributes: melontikAttributes(),
      reference: melontikReference(),
      costs: [tryCogs('a', '233.00'), tryCogs('b', '165.00')],
      acceptedReturns: [],
    });

    expect(result.issues).toEqual([]);

    const saleA = requireLine(result.lines, ProfitLineType.SALE, 'a');
    expect(saleA.amount.gross.toFixed(2)).toBe('491.28');
    expect(saleA.amount.vat.toFixed(2)).toBe('44.66');
    const saleB = requireLine(result.lines, ProfitLineType.SALE, 'b');
    expect(saleB.amount.gross.toFixed(2)).toBe('380.47');
    expect(saleB.amount.vat.toFixed(2)).toBe('34.59');

    const commissionA = requireLine(result.lines, ProfitLineType.COMMISSION, 'a');
    expect(commissionA.amount.gross.toFixed(2)).toBe('93.34');
    expect(commissionA.amount.vat.toFixed(2)).toBe('15.56');
    const commissionB = requireLine(result.lines, ProfitLineType.COMMISSION, 'b');
    expect(commissionB.amount.gross.toFixed(2)).toBe('72.29');
    expect(commissionB.amount.vat.toFixed(2)).toBe('12.05');

    const costA = requireLine(result.lines, ProfitLineType.COST_COGS, 'a');
    expect(costA.amount.gross.toFixed(2)).toBe('233.00');
    expect(costA.amount.vat.toFixed(2)).toBe('21.18');
    const costB = requireLine(result.lines, ProfitLineType.COST_COGS, 'b');
    expect(costB.amount.gross.toFixed(2)).toBe('165.00');
    expect(costB.amount.vat.toFixed(2)).toBe('15.00');

    const stoppageA = requireLine(result.lines, ProfitLineType.STOPPAGE, 'a');
    expect(stoppageA.amount.gross.toFixed(2)).toBe('4.47');
    const stoppageB = requireLine(result.lines, ProfitLineType.STOPPAGE, 'b');
    expect(stoppageB.amount.gross.toFixed(2)).toBe('3.46');

    const serviceFee = requireLine(result.lines, ProfitLineType.SERVICE_FEE, null);
    expect(serviceFee.amount.gross.toFixed(2)).toBe('13.19');
    expect(serviceFee.amount.vat.toFixed(2)).toBe('2.20');

    const shipping = requireLine(result.lines, ProfitLineType.SHIPPING, null);
    expect(shipping.amount.gross.toFixed(2)).toBe('98.34');
    expect(shipping.amount.vat.toFixed(2)).toBe('16.39');
  });

  it('reproduces 191.79 net profit and the clamped 188.66', () => {
    const result = estimateTrendyolParcel({
      snapshot: melontikSnapshot(),
      attributes: melontikAttributes(),
      reference: melontikReference(),
      costs: [tryCogs('a', '233.00'), tryCogs('b', '165.00')],
      acceptedReturns: [],
    });

    const withNegative = computeProfitStatement({
      lines: result.lines,
      view: 'BEST_KNOWN',
      settings: INCLUDE_NEGATIVE,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: result.issues,
    });
    expect(withNegative.netProfit?.toFixed(2)).toBe('191.79');
    expect(withNegative.status).toBe(ProfitStatus.ESTIMATED);

    const clamped = computeProfitStatement({
      lines: result.lines,
      view: 'BEST_KNOWN',
      settings: CLAMP_NEGATIVE,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: result.issues,
    });
    expect(clamped.netProfit?.toFixed(2)).toBe('188.66');
  });

  it('allocates the shipping line evenly across the two items', () => {
    const result = estimateTrendyolParcel({
      snapshot: melontikSnapshot(),
      attributes: melontikAttributes(),
      reference: melontikReference(),
      costs: [tryCogs('a', '233.00'), tryCogs('b', '165.00')],
      acceptedReturns: [],
    });

    const shipping = requireLine(result.lines, ProfitLineType.SHIPPING, null);
    const shares = allocateParcelLine(
      shipping,
      itemsForAllocation(ProfitLineType.SHIPPING, result.allocation),
    );
    expect(shares.map((share) => share.amount.gross.toFixed(2))).toEqual(['49.17', '49.17']);
    expect(shares.map((share) => share.amount.vat.toFixed(2))).toEqual(['8.20', '8.19']);
  });

  it('reconciles the sale cycle: 191.79 stays through PARTIALLY_SETTLED and SETTLED', () => {
    const snapshot = melontikSnapshot();
    const attributes = melontikAttributes();
    const reference = melontikReference();
    const result = estimateTrendyolParcel({
      snapshot,
      attributes,
      reference,
      costs: [tryCogs('a', '233.00'), tryCogs('b', '165.00')],
      acceptedReturns: [],
    });

    // The sale payment order confirms the service fee and stoppage, but the shipping
    // invoice has not arrived, so the order is only partially settled.
    const partialMapping = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: reference.fees,
      records: melontikRecords(),
      cargoItems: [],
      estimateLines: result.lines,
    });
    expect(partialMapping.issues).toEqual([]);

    const actualSale = requireLine(partialMapping.lines, ProfitLineType.SALE, 'a');
    expect(actualSale.amount.gross.toFixed(2)).toBe('491.28');
    const actualCommission = requireLine(partialMapping.lines, ProfitLineType.COMMISSION, 'b');
    expect(actualCommission.amount.gross.toFixed(2)).toBe('72.29');

    const partial = computeProfitStatement({
      lines: [...result.lines, ...partialMapping.lines],
      view: 'BEST_KNOWN',
      settings: INCLUDE_NEGATIVE,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [...result.issues, ...partialMapping.issues],
    });
    expect(partial.netProfit?.toFixed(2)).toBe('191.79');
    expect(partial.status).toBe(ProfitStatus.PARTIALLY_SETTLED);

    // The cargo invoice lands the outbound shipping, settling the order.
    const settledMapping = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: reference.fees,
      records: melontikRecords(),
      cargoItems: [outboundCargoItem()],
      estimateLines: result.lines,
    });
    const settledLines = [...result.lines, ...settledMapping.lines];
    const settled = computeProfitStatement({
      lines: settledLines,
      view: 'BEST_KNOWN',
      settings: INCLUDE_NEGATIVE,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [...result.issues, ...settledMapping.issues],
    });
    expect(settled.status).toBe(ProfitStatus.SETTLED);
    expect(settled.netProfit?.toFixed(2)).toBe('191.79');

    // The estimate view ignores the settlement actuals and still reproduces the estimate.
    const estimateView = computeProfitStatement({
      lines: settledLines,
      view: 'ESTIMATE',
      settings: INCLUDE_NEGATIVE,
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: result.issues,
    });
    expect(estimateView.netProfit?.toFixed(2)).toBe('191.79');
    expect(estimateView.status).toBe(ProfitStatus.ESTIMATED);
  });
});
