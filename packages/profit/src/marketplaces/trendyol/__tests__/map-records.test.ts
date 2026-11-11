import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ShippingTariffSource,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import { makeLine } from '../../../__tests__/helpers/make-profit-line';
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
    // The Sale credit is the list price and the Discount debt the seller discount, so the
    // settled sale line carries them like the estimate does (list - discount = gross).
    expect(sale?.inputs).toEqual({
      recordIds: 'rec-1,rec-2',
      listGross: '529.00',
      sellerDiscountGross: '37.72',
    });
    // The external record points at the Sale, never at the Discount.
    expect(sale?.externalRecord?.rawType).toBe('Sale');
    expect(sale?.externalRecord).toEqual({ recordId: 'rec-1', rawType: 'Sale' });

    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('93.34');
    expect(commission?.amount.vat.toFixed(2)).toBe('15.56');
    expect(commission?.vatRatePct?.toString()).toBe('20');
    expect(commission?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(commission?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(commission?.inputs).toEqual({ recordIds: 'rec-1,rec-2' });
  });

  it('carries a zero seller discount on a settled sale line without a discount', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '529.00', saleVatRatePct: '10', barcode: 'bc-a' }),
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
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('529.00');
    expect(sale?.inputs).toEqual({
      recordIds: 'rec-1',
      listGross: '529.00',
      sellerDiscountGross: '0.00',
    });
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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

  it('sums several outbound cargo items into one shipping line', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });
    const cargoItems = [
      makeCargoItem({
        invoiceSerial: 'INV2',
        parcelUniqueId: 'P1',
        itemType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
        amountGross: '49.17',
        desi: '1',
      }),
      makeCargoItem({
        invoiceSerial: 'INV1',
        parcelUniqueId: 'P2',
        itemType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
        amountGross: '49.17',
        desi: '1',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records: [],
      cargoItems,
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const shipping = result.lines.find((line) => line.type === ProfitLineType.SHIPPING);
    expect(shipping?.amount.gross.toFixed(2)).toBe('98.34');
    expect(shipping?.amount.vat.toFixed(2)).toBe('16.39');
    // invoiceSerials are the unique serials, sorted as text.
    expect(shipping?.inputs.invoiceSerials).toBe('INV1,INV2');
  });

  it('confirms with the smallest payment order id when several match', () => {
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
    ];
    const records = [
      makeRecord({
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '10.00',
        paymentOrderId: '200',
      }),
      makeRecord({
        recordId: 'sale-2',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '10.00',
        paymentOrderId: '100',
      }),
      makeRecord({ recordId: 'po-200', transactionType: 'PaymentOrder', paymentOrderId: '200' }),
      makeRecord({ recordId: 'po-100', transactionType: 'PaymentOrder', paymentOrderId: '100' }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines,
    });

    const serviceCopy = result.lines.find(
      (line) =>
        line.type === ProfitLineType.SERVICE_FEE &&
        line.source === ProfitLineSource.MARKETPLACE_RECORD,
    );
    expect(serviceCopy?.inputs.confirmedBy).toBe('payment-order:100');
    expect(serviceCopy?.externalRecord).toEqual({ recordId: 'po-100', rawType: 'PaymentOrder' });
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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

  /** A seller-cargo parcel with shipping estimates and both payment cycles paid. */
  function sellerCargoScenario(): {
    readonly snapshot: ReturnType<typeof makeParcel>;
    readonly attributes: ReturnType<typeof makeTrendyolAttributes>;
    readonly estimateLines: ProfitLine[];
    readonly records: TrendyolSettlementRecord[];
  } {
    return {
      snapshot: makeParcel({
        items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
      }),
      attributes: makeTrendyolAttributes({ usesSellerCargoAgreement: true }),
      estimateLines: [
        makeLine({
          type: ProfitLineType.SHIPPING,
          gross: '60.00',
          vat: '10.00',
          certainty: ProfitLineCertainty.ESTIMATE,
        }),
        makeLine({
          type: ProfitLineType.RETURN_SHIPPING,
          gross: '72.00',
          vat: '12.00',
          certainty: ProfitLineCertainty.ESTIMATE,
        }),
        makeLine({
          type: ProfitLineType.SERVICE_FEE,
          gross: '13.19',
          vat: '2.20',
          level: ProfitLineLevel.PARCEL,
          certainty: ProfitLineCertainty.ESTIMATE,
        }),
      ],
      records: [
        makeRecord({
          recordId: 'sale-1',
          transactionType: 'Sale',
          barcode: 'bc-a',
          paymentOrderId: 'pay-1',
        }),
        makeRecord({
          recordId: 'po-1',
          transactionType: 'PaymentOrder',
          paymentOrderId: 'pay-1',
        }),
        makeRecord({
          recordId: 'ret-1',
          transactionType: 'Return',
          barcode: 'bc-a',
          debt: '0',
          paymentOrderId: 'pay-2',
        }),
        makeRecord({
          recordId: 'po-2',
          transactionType: 'PaymentOrder',
          paymentOrderId: 'pay-2',
        }),
      ],
    };
  }

  it('confirms seller-cargo shipping only without a cargo invoice line on an own-contract store', () => {
    // Review focus 3: a store priced from its own tariff keeps confirming the seller-cargo
    // shipping legs with the payment order, exactly as before.
    const { snapshot, attributes, estimateLines, records } = sellerCargoScenario();

    const withoutCargo = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.OWN_CONTRACT,
      records,
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
    const returnShippingCopy = withoutCargo.lines.find(
      (line) =>
        line.type === ProfitLineType.RETURN_SHIPPING &&
        line.source === ProfitLineSource.MARKETPLACE_RECORD,
    );
    expect(returnShippingCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(returnShippingCopy?.inputs.confirmedBy).toBe('payment-order:pay-2');

    const withCargo = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.OWN_CONTRACT,
      records,
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

  it('keeps seller-cargo shipping as an estimate on a Trendyol-contract store', () => {
    // Owner decision 2026-11-10: on a Trendyol-contract store the engine does not know the
    // seller's real cargo price, so a payment order never turns the shipping legs into
    // actuals. The rest of the cycle is still confirmed.
    const { snapshot, attributes, estimateLines, records } = sellerCargoScenario();

    const result = mapTrendyolRecords({
      snapshot,
      attributes,
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines,
    });

    expect(result.issues).toEqual([]);
    expect(
      result.lines.filter(
        (line) =>
          line.type === ProfitLineType.SHIPPING || line.type === ProfitLineType.RETURN_SHIPPING,
      ),
    ).toHaveLength(0);
    const serviceCopy = result.lines.find((line) => line.type === ProfitLineType.SERVICE_FEE);
    expect(serviceCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(serviceCopy?.inputs.confirmedBy).toBe('payment-order:pay-1');
  });

  it('separates period records, drops ignored ones and flags unverified ones', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const stoppage = makeRecord({ recordId: 'st-1', transactionType: 'Stoppage' });
    const wire = makeRecord({ recordId: 'wt-1', transactionType: 'WireTransfer' });
    // ProvisionPositive is still UNVERIFIED (Coupon now maps to DISCOUNT), so it is the
    // unverified example the mapper flags. It never reaches barcode matching, so it
    // carries no barcode.
    const provision = makeRecord({
      recordId: 'pv-1',
      transactionType: 'ProvisionPositive',
    });

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records: [stoppage, wire, provision],
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.periodRecords).toEqual([stoppage]);
    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: 'ProvisionPositive:pv-1',
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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

  it('flags a discount that has no sale', () => {
    // A discount bound to an item with no sale cannot net against anything; it must
    // not vanish silently.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'bc-a' })],
    });
    const records = [
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '10.00',
        commissionAmount: '2.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: 'a',
        detail: 'DISCOUNT_WITHOUT_SALE:disc-1',
      },
    ]);
  });

  it('still confirms the sale cycle when the sale record cannot be bound to an item', () => {
    // The sale cycle id comes from every Sale record, bound or not: an ambiguous sale
    // still joins its payment cycle so its payment order can confirm the estimates.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', barcode: 'dup' }),
        makeItem({ orderItemId: 'b', listGross: '100.00', barcode: 'dup' }),
      ],
    });
    const estimateLines = [
      makeLine({
        type: ProfitLineType.SERVICE_FEE,
        gross: '13.19',
        vat: '2.20',
        level: ProfitLineLevel.PARCEL,
        certainty: ProfitLineCertainty.ESTIMATE,
      }),
    ];
    const saleRecord = makeRecord({
      recordId: 'sale-1',
      transactionType: 'Sale',
      barcode: 'dup',
      credit: '10.00',
      paymentOrderId: 'P1',
    });
    const paymentOrder = makeRecord({
      recordId: 'po-1',
      transactionType: 'PaymentOrder',
      paymentOrderId: 'P1',
    });

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records: [saleRecord, paymentOrder],
      cargoItems: [],
      estimateLines,
    });

    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: null,
        detail: 'MULTIPLE_ITEMS:sale-1',
      },
    ]);
    const copies = result.lines.filter(
      (line) => line.source === ProfitLineSource.MARKETPLACE_RECORD,
    );
    expect(copies).toHaveLength(1);
    const serviceCopy = result.lines.find((line) => line.type === ProfitLineType.SERVICE_FEE);
    expect(serviceCopy?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(serviceCopy?.inputs.confirmedBy).toBe('payment-order:P1');
    expect(serviceCopy?.externalRecord).toEqual({ recordId: 'po-1', rawType: 'PaymentOrder' });
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
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
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      { code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH, orderItemId: 'a', detail: 'NEGATIVE_NET:a' },
    ]);
  });

  it('nets a coupon against the sale like a discount', () => {
    // Live Trendyol (3 Nov 2026): a Coupon is a debt like a Discount, and the Sale credit
    // already includes the coupon, so the net sale subtracts both the discount and the
    // coupon. 920.00 - 46.00 - 19.65 = 854.35; 174.80 - 8.74 - 3.73 = 162.33.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '920.00', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '920.00',
        commissionAmount: '174.80',
      }),
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '46.00',
        commissionAmount: '8.74',
      }),
      makeRecord({
        recordId: 'coup-1',
        transactionType: 'Coupon',
        barcode: 'bc-a',
        debt: '19.65',
        commissionAmount: '3.73',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('854.35');
    // The coupon record joins the sale reference so the stored line cites every input.
    // The list and discount come from the records, and the coupon counts as a discount.
    expect(sale?.inputs).toEqual({
      recordIds: 'coup-1,disc-1,sale-1',
      listGross: '920.00',
      sellerDiscountGross: '65.65',
    });
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('162.33');
  });

  it('reverses the discount on a returned item so a full return nets the sale legs to zero', () => {
    // Stage example (3 Nov 2026): a fully returned item carries a Sale, a Discount and a
    // Coupon on the sale side and a Return plus both reversals on the return side. The sale
    // legs net to 80.16 / 16.03 and the return legs net to the same, so sale minus return
    // is zero. SALE = 333.50 - 3.34 - 250.00; SALE_RETURN = 333.50 - 3.34 - 250.00.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '333.50', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '333.50',
        commissionAmount: '66.70',
      }),
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '3.34',
        commissionAmount: '0.67',
      }),
      makeRecord({
        recordId: 'coup-1',
        transactionType: 'Coupon',
        barcode: 'bc-a',
        debt: '250.00',
        commissionAmount: '50.00',
      }),
      makeRecord({
        recordId: 'ret-1',
        transactionType: 'Return',
        barcode: 'bc-a',
        debt: '333.50',
        commissionAmount: '66.70',
      }),
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '3.34',
        commissionAmount: '0.67',
      }),
      makeRecord({
        recordId: 'cc-1',
        transactionType: 'CouponCancel',
        barcode: 'bc-a',
        credit: '250.00',
        commissionAmount: '50.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('80.16');
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('16.03');
    const saleReturn = result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('80.16');
    // The reversal records join the return reference; the external record stays the Return.
    expect(saleReturn?.inputs.recordIds).toBe('cc-1,dc-1,ret-1');
    expect(saleReturn?.externalRecord).toEqual({ recordId: 'ret-1', rawType: 'Return' });
    const commissionRefund = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION_REFUND,
    );
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('16.03');
  });

  it('reverses a coupon on a returned item the same way', () => {
    // Only a CouponCancel reverses the return here: SALE = 333.50 - 250.00 = 83.50 and the
    // return nets the same, so the sale and return legs cancel.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '333.50', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '333.50',
        commissionAmount: '66.70',
      }),
      makeRecord({
        recordId: 'coup-1',
        transactionType: 'Coupon',
        barcode: 'bc-a',
        debt: '250.00',
        commissionAmount: '50.00',
      }),
      makeRecord({
        recordId: 'ret-1',
        transactionType: 'Return',
        barcode: 'bc-a',
        debt: '333.50',
        commissionAmount: '66.70',
      }),
      makeRecord({
        recordId: 'cc-1',
        transactionType: 'CouponCancel',
        barcode: 'bc-a',
        credit: '250.00',
        commissionAmount: '50.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('83.50');
    const saleReturn = result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('83.50');
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('16.70');
    const commissionRefund = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION_REFUND,
    );
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('16.70');
  });

  it('nets a discount and its reversal on a cancelled item to nothing', () => {
    // A cancelled item keeps a Discount and its DiscountCancel but no Sale and no Return.
    // The reversal exactly gives the discount back (3.34 / 0.67), so nothing is produced
    // and the discount-without-sale warning is suppressed.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '333.50', barcode: 'bc-a' })],
    });
    const records = [
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '3.34',
        commissionAmount: '0.67',
      }),
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '3.34',
        commissionAmount: '0.67',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('flags a discount reversal that has nothing to reverse', () => {
    // A lone DiscountCancel has no discount, sale or return to net against: it must not
    // vanish silently.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '333.50', barcode: 'bc-a' })],
    });
    const records = [
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '3.34',
        commissionAmount: '0.67',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: 'a',
        detail: 'UNMATCHED_DISCOUNT_REVERSAL:dc-1',
      },
    ]);
  });

  it('flags a discount reversal on an item that was sold but not returned', () => {
    // The item was sold and discounted but not returned, so the reversal cannot net: the
    // sale stays today's net (333.50 - 3.34 = 330.16) and the reversal is flagged.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '333.50', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '333.50',
        commissionAmount: '66.70',
      }),
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '3.34',
        commissionAmount: '0.67',
      }),
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '3.34',
        commissionAmount: '0.67',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('330.16');
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('66.03');
    expect(result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN)).toBeUndefined();
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: 'a',
        detail: 'UNMATCHED_DISCOUNT_REVERSAL:dc-1',
      },
    ]);
  });

  it('treats a reversal on an export sale like an export return', () => {
    // On an export sale a reversal does not reverse anything (design section 18); it is
    // flagged exactly like an export return and never nets.
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '333.50', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '3.34',
        commissionAmount: '0.67',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.UNMAPPED_MARKETPLACE_RECORD,
        orderItemId: null,
        detail: 'EXPORT_RETURN:dc-1',
      },
    ]);
  });

  it('drops both return lines and flags NEGATIVE_NET when the reversals exceed the return', () => {
    // A reversal credit larger than the Return debt would drive the net return negative
    // (reversal 150.00 > return 100.00, and reversal commission 30.00 > return commission
    // 20.00). The net turns negative on both legs, so neither line is written and the
    // item is flagged exactly like any other negative net.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '333.50', saleVatRatePct: '20', barcode: 'bc-a' }),
      ],
    });
    const records = [
      makeRecord({
        recordId: 'ret-1',
        transactionType: 'Return',
        barcode: 'bc-a',
        debt: '100.00',
        commissionAmount: '20.00',
      }),
      makeRecord({
        recordId: 'cc-1',
        transactionType: 'CouponCancel',
        barcode: 'bc-a',
        credit: '150.00',
        commissionAmount: '30.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN)).toBeUndefined();
    expect(
      result.lines.find((line) => line.type === ProfitLineType.COMMISSION_REFUND),
    ).toBeUndefined();
    expect(result.issues).toEqual([
      { code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH, orderItemId: 'a', detail: 'NEGATIVE_NET:a' },
    ]);
  });

  it('nets a partial return of a multi-unit item with its reversal share', () => {
    // A two-unit item: both units sell (two Sale rows of 100.00, each with a 10.00 Coupon),
    // but only one unit is returned (one Return of 100.00 with its 10.00 CouponCancel). The
    // sale legs cover both units (200.00 - 20.00 = 180.00) while the return legs cover only
    // the returned unit (100.00 - 10.00 = 90.00). Commission nets the same way per leg.
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
        recordId: 'sale-1',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '100.00',
        commissionAmount: '20.00',
      }),
      makeRecord({
        recordId: 'sale-2',
        transactionType: 'Sale',
        barcode: 'bc-a',
        credit: '100.00',
        commissionAmount: '20.00',
      }),
      makeRecord({
        recordId: 'coup-1',
        transactionType: 'Coupon',
        barcode: 'bc-a',
        debt: '10.00',
        commissionAmount: '2.00',
      }),
      makeRecord({
        recordId: 'coup-2',
        transactionType: 'Coupon',
        barcode: 'bc-a',
        debt: '10.00',
        commissionAmount: '2.00',
      }),
      makeRecord({
        recordId: 'ret-1',
        transactionType: 'Return',
        barcode: 'bc-a',
        debt: '100.00',
        commissionAmount: '20.00',
      }),
      makeRecord({
        recordId: 'cc-1',
        transactionType: 'CouponCancel',
        barcode: 'bc-a',
        credit: '10.00',
        commissionAmount: '2.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.issues).toEqual([]);
    const sale = result.lines.find((line) => line.type === ProfitLineType.SALE);
    expect(sale?.amount.gross.toFixed(2)).toBe('180.00');
    const commission = result.lines.find((line) => line.type === ProfitLineType.COMMISSION);
    expect(commission?.amount.gross.toFixed(2)).toBe('36.00');
    const saleReturn = result.lines.find((line) => line.type === ProfitLineType.SALE_RETURN);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('90.00');
    const commissionRefund = result.lines.find(
      (line) => line.type === ProfitLineType.COMMISSION_REFUND,
    );
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('18.00');
  });

  it('flags both the discount without sale and the unmatched reversal when they do not cancel', () => {
    // A Discount (debt 10.00) and a DiscountCancel (credit 7.00) with no sale and no
    // return: the reversal does not give the discount back exactly (7.00 != 10.00), so the
    // pair is not suppressed. The discount is flagged DISCOUNT_WITHOUT_SALE and the reversal
    // UNMATCHED_DISCOUNT_REVERSAL; no line is produced.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '333.50', barcode: 'bc-a' })],
    });
    const records = [
      makeRecord({
        recordId: 'disc-1',
        transactionType: 'Discount',
        barcode: 'bc-a',
        debt: '10.00',
        commissionAmount: '2.00',
      }),
      makeRecord({
        recordId: 'dc-1',
        transactionType: 'DiscountCancel',
        barcode: 'bc-a',
        credit: '7.00',
        commissionAmount: '1.00',
      }),
    ];

    const result = mapTrendyolRecords({
      snapshot,
      attributes: makeTrendyolAttributes(),
      fees: FEES,
      shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
      records,
      cargoItems: [],
      estimateLines: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: 'a',
        detail: 'DISCOUNT_WITHOUT_SALE:disc-1',
      },
      {
        code: ProfitIssueCode.AMBIGUOUS_RECORD_MATCH,
        orderItemId: 'a',
        detail: 'UNMATCHED_DISCOUNT_REVERSAL:dc-1',
      },
    ]);
  });
});
