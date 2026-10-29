import { Decimal } from 'decimal.js';
import {
  FxRateSource,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { toCurrencyCode } from '../../../core/fx/currency-code';
import { InvalidParcelSnapshotError } from '../../../core/parcel-snapshot';
import { type ProfitLine } from '../../../core/profit-line';
import { mapTrendyolRecords } from '../map-records';
import {
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
  type TrendyolCargoInvoiceItem,
  type TrendyolSettlementRecord,
  type TrendyolTransactionType,
} from '../settlement-records';

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

/** Local cargo-invoice-item builder with text money fields. */
interface MakeCargoItemParams {
  readonly invoiceSerial: string;
  readonly parcelUniqueId: string;
  readonly itemType: string;
  readonly amountGross: string;
  readonly desi?: string | null;
}

function makeCargoItem(params: MakeCargoItemParams): TrendyolCargoInvoiceItem {
  return {
    invoiceSerial: params.invoiceSerial,
    parcelUniqueId: params.parcelUniqueId,
    itemType: params.itemType,
    amountGross: new Decimal(params.amountGross),
    desi: params.desi === undefined || params.desi === null ? null : new Decimal(params.desi),
  };
}

const FEES = trendyolReference().fees;

describe('mapTrendyolRecords', () => {
  it('nets the melontik sale and discount into actual sale and commission', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '529.00',
          sellerDiscountGross: '37.72',
          saleVatRatePct: '10',
          barcode: 'bc-a',
        }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'rec-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '529.00',
        commissionAmount: '100.51',
      }),
      makeRecord({
        recordId: 'rec-2',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '37.72',
        commissionAmount: '7.17',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.level).toBe(ProfitLineLevel.ITEM);
    expect(sale?.orderItemId).toBe('a');
    expect(sale?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(sale?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(sale?.amount.gross.toFixed(2)).toBe('491.28');
    expect(sale?.amount.vat.toFixed(2)).toBe('44.66');
    expect(sale?.vatRatePct?.toString()).toBe('10');
    expect(sale?.fx.source).toBe(FxRateSource.NATIVE);
    expect(sale?.inputs.recordIds).toBe('rec-1,rec-2');
    expect(sale?.externalRecord).toEqual({ recordId: 'rec-1', rawType: 'Sale' });

    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('93.34');
    expect(commission?.amount.vat.toFixed(2)).toBe('15.56');
    expect(commission?.vatRatePct?.toString()).toBe('20');
    expect(commission?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(commission?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(commission?.inputs.recordIds).toBe('rec-1,rec-2');
  });

  it('sums per-unit duplicate sale rows', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '400.00',
          quantity: 2,
          saleVatRatePct: '20',
          barcode: 'bc-a',
        }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'rec-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '200.00',
        commissionAmount: '40.00',
      }),
      makeRecord({
        recordId: 'rec-2',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '200.00',
        commissionAmount: '40.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('400.00');
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('80.00');
  });

  it('maps return rows to sale return and commission refund', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '529.00',
          sellerDiscountGross: '37.72',
          saleVatRatePct: '10',
          barcode: 'bc-a',
        }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'ret-1',
        transactionType: 'Return',
        barcode: 'bc-a',
        debt: '491.28',
        commissionAmount: '93.34',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    const saleReturn = result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('491.28');
    expect(saleReturn?.amount.vat.toFixed(2)).toBe('44.66');
    expect(saleReturn?.vatRatePct?.toString()).toBe('10');
    expect(saleReturn?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(saleReturn?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(saleReturn?.externalRecord).toEqual({ recordId: 'ret-1', rawType: 'Return' });

    const commissionRefund = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION_REFUND,
    );
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('93.34');
    expect(commissionRefund?.amount.vat.toFixed(2)).toBe('15.56');
  });

  it('maps cargo invoice items to shipping and return shipping', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });
    const cargoItems = [
      makeCargoItem({
        invoiceSerial: 'INV1',
        parcelUniqueId: 'P1',
        itemType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
        amountGross: '98.34',
        desi: '2',
      }),
      makeCargoItem({
        invoiceSerial: 'INV1',
        parcelUniqueId: 'P1',
        itemType: TRENDYOL_CARGO_RETURN_ITEM_TYPE,
        amountGross: '93.05',
        desi: '1',
      }),
      makeCargoItem({
        invoiceSerial: 'INV2',
        parcelUniqueId: 'P9',
        itemType: 'Komisyon Faturasi',
        amountGross: '5.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [],
      cargoItems,
      estimateLines: [],
    });

    const shipping = result.lines.find((line) => line.type === ProfitLineType.SHIPPING);
    expect(shipping?.level).toBe(ProfitLineLevel.PARCEL);
    expect(shipping?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(shipping?.source).toBe(ProfitLineSource.CARGO_INVOICE);
    expect(shipping?.amount.gross.toFixed(2)).toBe('98.34');
    expect(shipping?.amount.vat.toFixed(2)).toBe('16.39');
    expect(shipping?.inputs.invoiceSerials).toBe('INV1');

    const returnShipping = result.lines.find(
      (line) => line.type === ProfitLineType.RETURN_SHIPPING,
    );
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
    expect(returnShipping?.amount.vat.toFixed(2)).toBe('15.51');

    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: 'CARGO_ITEM:Komisyon Faturasi:INV2',
      },
    ]);
  });

  it('confirms sale-cycle estimates when the sale payment order is present', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const estimateLines = [
      makeLine({
        type: ProfitLineType.SERVICE_FEE,
        gross: '13.19',
        vat: '2.20',
        level: ProfitLineLevel.PARCEL,
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
      makeLine({
        type: ProfitLineType.STOPPAGE,
        gross: '4.47',
        orderItemId: 'a',
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
    ];
    const saleRecord = makeRecord({
      recordId: 'sale-1',
      transactionType: 'Sale',
      barcode: 'bc-a',
      paymentOrderId: '58450612',
    });
    const paymentOrder = makeRecord({
      recordId: 'po-1',
      transactionType: 'PaymentOrder',
      paymentOrderId: '58450612',
    });

    const confirmed = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [saleRecord, paymentOrder],
      cargoItems: [],
      estimateLines,
    });

    const copies = confirmed.lines.filter(
      (line) => line.source === ProfitLineSource.MARKETPLACE_RECORD,
    );
    expect(copies).toHaveLength(2);

    const serviceCopy = confirmed.lines.find((line) => line.type === ProfitLineType.SERVICE_FEE);
    expect(serviceCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(serviceCopy?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(serviceCopy?.amount.gross.toFixed(2)).toBe('13.19');
    expect(serviceCopy?.amount.vat.toFixed(2)).toBe('2.20');
    expect(serviceCopy?.inputs.confirmedBy).toBe('payment-order:58450612');
    expect(serviceCopy?.externalRecord).toEqual({ recordId: 'po-1', rawType: 'PaymentOrder' });

    const stoppageCopy = confirmed.lines.find((line) => line.type === ProfitLineType.STOPPAGE);
    expect(stoppageCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(stoppageCopy?.amount.gross.toFixed(2)).toBe('4.47');
    expect(stoppageCopy?.inputs.confirmedBy).toBe('payment-order:58450612');

    const withoutPayment = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [saleRecord],
      cargoItems: [],
      estimateLines,
    });
    expect(
      withoutPayment.lines.filter((line) => line.source === ProfitLineSource.MARKETPLACE_RECORD),
    ).toHaveLength(0);
  });

  it('confirms return-leg estimates only with the return payment order', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const estimateLines = [
      makeLine({
        type: ProfitLineType.STOPPAGE_REFUND,
        gross: '4.47',
        orderItemId: 'a',
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
    ];
    const saleRecord = makeRecord({
      recordId: 'sale-1',
      transactionType: 'Sale',
      barcode: 'bc-a',
      paymentOrderId: '100',
    });
    const salePayment = makeRecord({
      recordId: 'po-100',
      transactionType: 'PaymentOrder',
      paymentOrderId: '100',
    });
    const returnRecord = makeRecord({
      recordId: 'ret-1',
      transactionType: 'Return',
      barcode: 'bc-a',
      debt: '0',
      paymentOrderId: '200',
    });

    const withoutReturnPayment = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [saleRecord, salePayment, returnRecord],
      cargoItems: [],
      estimateLines,
    });
    expect(
      withoutReturnPayment.lines.filter(
        (line) => line.source === ProfitLineSource.MARKETPLACE_RECORD,
      ),
    ).toHaveLength(0);

    const returnPayment = makeRecord({
      recordId: 'po-200',
      transactionType: 'PaymentOrder',
      paymentOrderId: '200',
    });
    const withReturnPayment = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [saleRecord, salePayment, returnRecord, returnPayment],
      cargoItems: [],
      estimateLines,
    });
    const copy = withReturnPayment.lines.find(
      (line) => line.type === ProfitLineType.STOPPAGE_REFUND,
    );
    expect(copy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(copy?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(copy?.inputs.confirmedBy).toBe('payment-order:200');
    expect(copy?.externalRecord).toEqual({ recordId: 'po-200', rawType: 'PaymentOrder' });
  });

  it('confirms seller-cargo shipping only without a cargo invoice line', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const attributes = makeTrendyolAttributes({ usesSellerCargoAgreement: true });
    const estimateLines = [
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '60.00',
        vat: '10.00',
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
    ];
    const saleRecord = makeRecord({
      recordId: 'sale-1',
      transactionType: 'Sale',
      barcode: 'bc-a',
      paymentOrderId: 'pay-1',
    });
    const paymentOrder = makeRecord({
      recordId: 'po-1',
      transactionType: 'PaymentOrder',
      paymentOrderId: 'pay-1',
    });

    const withoutCargo = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: FEES,
      records: [saleRecord, paymentOrder],
      cargoItems: [],
      estimateLines,
    });
    const shippingCopy = withoutCargo.lines.find(
      (line) =>
        line.type === ProfitLineType.SHIPPING &&
        line.source === ProfitLineSource.MARKETPLACE_RECORD,
    );
    expect(shippingCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(shippingCopy?.inputs.confirmedBy).toBe('payment-order:pay-1');

    const withCargo = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: FEES,
      records: [saleRecord, paymentOrder],
      cargoItems: [
        makeCargoItem({
          invoiceSerial: 'INV1',
          parcelUniqueId: 'P1',
          itemType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
          amountGross: '70.00',
        }),
      ],
      estimateLines,
    });
    expect(
      withCargo.lines.filter(
        (line) =>
          line.type === ProfitLineType.SHIPPING &&
          line.source === ProfitLineSource.MARKETPLACE_RECORD,
      ),
    ).toHaveLength(0);
    expect(
      withCargo.lines.filter(
        (line) =>
          line.type === ProfitLineType.SHIPPING && line.source === ProfitLineSource.CARGO_INVOICE,
      ),
    ).toHaveLength(1);
  });

  it('separates period records, drops ignored ones and flags unverified ones', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const stoppage = makeRecord({ recordId: 'st-1', transactionType: 'Stoppage' });
    const wire = makeRecord({ recordId: 'wt-1', transactionType: 'WireTransfer' });
    const coupon = makeRecord({ recordId: 'cp-1', transactionType: 'Coupon', barcode: 'bc-a' });

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [stoppage, wire, coupon],
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.periodRecords).toEqual([stoppage]);
    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: 'Coupon:cp-1',
      },
    ]);
  });

  it('flags a record whose barcode matches no item or several items', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'dup' }),
        makeItem({ orderItemId: 'b', listGross: '100.00', barcode: 'dup' }),
      ],
    });
    const noItem = makeRecord({
      recordId: 'none-1',
      transactionType: 'Sale',
      barcode: 'missing',
      credit: '10.00',
    });
    const multiple = makeRecord({
      recordId: 'multi-1',
      transactionType: 'Sale',
      barcode: 'dup',
      credit: '10.00',
    });

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [noItem, multiple],
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      { code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH, orderItemId: null, detail: 'NO_ITEM:none-1' },
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: null,
        detail: 'MULTIPLE_ITEMS:multi-1',
      },
    ]);
  });

  it('flags an export return but still uses its cycle to confirm the operation fee', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const returnRecord = makeRecord({
      recordId: 'ret-1',
      transactionType: 'Return',
      barcode: 'bc-a',
      debt: '500.00',
      paymentOrderId: 'r1',
    });
    const paymentOrder = makeRecord({
      recordId: 'po-r1',
      transactionType: 'PaymentOrder',
      paymentOrderId: 'r1',
    });
    const estimateLines = [
      makeLine({
        type: ProfitLineType.INTERNATIONAL_OPERATION_FEE,
        gross: '283.50',
        orderItemId: 'a',
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [returnRecord, paymentOrder],
      cargoItems: [],
      estimateLines,
    });

    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: 'EXPORT_RETURN:ret-1',
      },
    ]);
    const copy = result.lines.find(
      (line) => line.type === ProfitLineType.INTERNATIONAL_OPERATION_FEE,
    );
    expect(copy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(copy?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(copy?.inputs.confirmedBy).toBe('payment-order:r1');
    expect(copy?.externalRecord).toEqual({ recordId: 'po-r1', rawType: 'PaymentOrder' });
  });

  it('rejects a parcel whose accounting currency is not TRY', () => {
    const snapshot = makeParcel({
      accountingCurrency: toCurrencyCode('USD'),
      items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
    });
    expect(() =>
      mapTrendyolRecords({
        snapshot,
        attributes: makeTrendyolAttributes(),
        fees: FEES,
        records: [],
        cargoItems: [],
        estimateLines: [],
      }),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('does not copy lines that are already actual', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const estimateLines: ProfitLine[] = [
      makeLine({
        type: ProfitLineType.STOPPAGE,
        gross: '4.47',
        orderItemId: 'a',
        certainty: ProfitLineCertainty.ACTUAL,
      }),
    ];
    const saleRecord = makeRecord({
      recordId: 'sale-1',
      transactionType: 'Sale',
      barcode: 'bc-a',
      paymentOrderId: 'pay-1',
    });
    const paymentOrder = makeRecord({
      recordId: 'po-1',
      transactionType: 'PaymentOrder',
      paymentOrderId: 'pay-1',
    });

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records: [saleRecord, paymentOrder],
      cargoItems: [],
      estimateLines,
    });
    expect(
      result.lines.filter((line) => line.source === ProfitLineSource.MARKETPLACE_RECORD),
    ).toHaveLength(0);
  });

  it('writes neither line when the net turns negative', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const records = [
      makeRecord({ recordId: 'sale-1', transactionType: 'Sale', barcode: 'bc-a', credit: '10.00' }),
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '12.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      { code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH, orderItemId: 'a', detail: 'NEGATIVE_NET:a' },
    ]);
  });
});
