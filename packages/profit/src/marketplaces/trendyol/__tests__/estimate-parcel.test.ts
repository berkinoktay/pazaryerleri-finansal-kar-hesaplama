import { Decimal } from 'decimal.js';
import { BaremTier, CostProfileType, ProfitIssueCode, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  makeTrendyolItemAttributes,
  trendyolReference,
  twoTierBaremBands,
} from '../../../__tests__/fixtures/trendyol-reference';
import { computeProfitStatement } from '../../../core/profit-statement';
import { selectLines } from '../../../core/select-lines';
import { type ItemCostInput } from '../../../core/seller-costs/build-seller-cost-lines';
import { estimateTrendyolParcel } from '../estimate-parcel';

/** A two-tier Barem version that prices the return of a table 1 order at table 1. */
function baremReturnsReference(): ReturnType<typeof trendyolReference> {
  return trendyolReference({
    shipping: {
      carrier: {
        code: 'TEXMP',
        supportsBarem: true,
        maxBaremDesi: new Decimal('10'),
        baremAppliesToReturns: true,
      },
      baremBands: twoTierBaremBands(),
    },
  });
}

/** A single COGS profile for one item, effective well before any order date. */
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
            vatRatePct: new Decimal('20'),
            archivedAt: null,
          },
        ],
      },
    ],
  };
}

describe('estimateTrendyolParcel', () => {
  it('returns nothing for a cancelled parcel', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        isCancelled: true,
        items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
      }),
      attributes: makeTrendyolAttributes({
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: trendyolReference(),
      costs: [],
      acceptedReturns: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([]);
    // A cancelled parcel yields no active and no returned items, but still carries
    // every item in allItems so a parcel-level actual line can be allocated.
    expect(result.allocation).toEqual({
      activeItems: [],
      returnedItems: [],
      allItems: [{ orderItemId: 'a', saleGross: new Decimal('100.00'), standaloneAmount: null }],
    });
  });

  it('produces lines in a fixed order and merges issues', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [
          makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '1' }),
          makeItem({ orderItemId: 'b', listGross: '200.00', unitDesi: '1' }),
        ],
      }),
      attributes: makeTrendyolAttributes({
        items: [
          makeTrendyolItemAttributes({ orderItemId: 'a' }),
          // No rate anywhere: null order rate and a category with no rule.
          makeTrendyolItemAttributes({
            orderItemId: 'b',
            orderCommissionRatePct: null,
            categoryId: null,
          }),
        ],
      }),
      reference: trendyolReference(),
      // Only item b is costed, so item a surfaces MISSING_COST.
      costs: [tryCogs('b', '50.00')],
      acceptedReturns: [],
    });

    expect(result.lines.map((line) => line.type)).toEqual([
      ProfitLineType.SALE,
      ProfitLineType.SALE,
      ProfitLineType.COMMISSION,
      ProfitLineType.COST_COGS,
      ProfitLineType.STOPPAGE,
      ProfitLineType.STOPPAGE,
      ProfitLineType.SERVICE_FEE,
      ProfitLineType.SHIPPING,
    ]);
    expect(result.issues).toEqual([
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: 'b', detail: null },
      { code: ProfitIssueCode.MISSING_COST, orderItemId: 'a', detail: null },
    ]);
  });

  it('leaves cancelled items out of every generator and of allocation', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [
          makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '1' }),
          makeItem({ orderItemId: 'b', listGross: '50.00', isCancelled: true }),
        ],
      }),
      attributes: makeTrendyolAttributes({
        items: [
          makeTrendyolItemAttributes({ orderItemId: 'a' }),
          makeTrendyolItemAttributes({ orderItemId: 'b' }),
        ],
      }),
      reference: trendyolReference(),
      costs: [tryCogs('a', '40.00')],
      acceptedReturns: [],
    });

    expect(result.lines.every((line) => line.orderItemId !== 'b')).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.allocation.activeItems.map((item) => item.orderItemId)).toEqual(['a']);
    expect(result.allocation.returnedItems).toEqual([]);
  });

  it('feeds standalone shipping into the active items and returns into the returned items', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [
          makeItem({ orderItemId: 'a', listGross: '200.00', unitDesi: '1', quantity: 2 }),
          makeItem({ orderItemId: 'b', listGross: '300.00', unitDesi: '3' }),
        ],
      }),
      attributes: makeTrendyolAttributes({
        items: [
          makeTrendyolItemAttributes({ orderItemId: 'a' }),
          makeTrendyolItemAttributes({ orderItemId: 'b' }),
        ],
      }),
      reference: trendyolReference(),
      costs: [tryCogs('a', '40.00'), tryCogs('b', '60.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    const active = result.allocation.activeItems;
    expect(active.map((item) => item.orderItemId)).toEqual(['a', 'b']);
    expect(active[0]?.saleGross.toFixed(2)).toBe('200.00');
    expect(active[0]?.standaloneAmount?.toFixed(2)).toBe('93.05'); // desi 1 x 2 -> key '2'
    expect(active[1]?.saleGross.toFixed(2)).toBe('300.00');
    expect(active[1]?.standaloneAmount?.toFixed(2)).toBe('112.36'); // desi 3 -> key '3'

    const returned = result.allocation.returnedItems;
    expect(returned.map((item) => item.orderItemId)).toEqual(['a']);
    expect(returned[0]?.saleGross.toFixed(2)).toBe('100.00'); // half of 200.00
    expect(returned[0]?.standaloneAmount?.toFixed(2)).toBe('93.05'); // desi 1 x accepted 1 -> key '1'
  });

  it('prices the return at Barem table 1 when the order went out at table 1', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
      }),
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: new Date('2026-09-10T20:59:00.000Z'),
        actualShipDate: new Date('2026-09-10T09:15:00.000Z'),
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: baremReturnsReference(),
      costs: [tryCogs('a', '40.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    const shipping = result.lines.find((line) => line.type === ProfitLineType.SHIPPING);
    const returnShipping = result.lines.find(
      (line) => line.type === ProfitLineType.RETURN_SHIPPING,
    );
    // Both legs: table 1 band [0, 199.99] -> 38.74 net -> 46.49 gross.
    expect(shipping?.amount.gross.toFixed(2)).toBe('46.49');
    expect(shipping?.inputs.baremTier).toBe(BaremTier.TABLE_1);
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('46.49');
    expect(returnShipping?.inputs.baremTier).toBe(BaremTier.TABLE_1);
  });

  it('prices the return at the desi tariff when the order went out late at table 2', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
      }),
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: new Date('2026-09-10T20:59:00.000Z'),
        actualShipDate: new Date('2026-09-11T08:00:00.000Z'),
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: baremReturnsReference(),
      costs: [tryCogs('a', '40.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    const shipping = result.lines.find((line) => line.type === ProfitLineType.SHIPPING);
    const returnShipping = result.lines.find(
      (line) => line.type === ProfitLineType.RETURN_SHIPPING,
    );
    // Forward: table 2 band [0, 199.99] -> 73.33 net -> 88.00 gross.
    expect(shipping?.amount.gross.toFixed(2)).toBe('88.00');
    expect(shipping?.inputs.baremTier).toBe(BaremTier.TABLE_2);
    // Return: desi tariff key '2' -> 77.54 net -> 93.05 gross.
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
    expect(returnShipping?.inputs.baremTier).toBeNull();
  });

  it('prices the return of a seller-cargo-agreement order at the desi tariff', () => {
    // The order went out under the seller's own carrier contract, not Trendyol's Barem,
    // so its return is never priced at Barem; the forward estimate itself is unchanged.
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
      }),
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: new Date('2026-09-10T20:59:00.000Z'),
        actualShipDate: new Date('2026-09-10T09:15:00.000Z'),
        usesSellerCargoAgreement: true,
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: baremReturnsReference(),
      costs: [tryCogs('a', '40.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    const shipping = result.lines.find((line) => line.type === ProfitLineType.SHIPPING);
    const returnShipping = result.lines.find(
      (line) => line.type === ProfitLineType.RETURN_SHIPPING,
    );
    // Forward: unchanged, table 1 band [0, 199.99] -> 38.74 net -> 46.49 gross.
    expect(shipping?.amount.gross.toFixed(2)).toBe('46.49');
    expect(shipping?.inputs.baremTier).toBe(BaremTier.TABLE_1);
    // Return: desi tariff key '2' -> 77.54 net -> 93.05 gross.
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
    expect(returnShipping?.inputs.tariffKind).toBe('DESI');
    expect(returnShipping?.inputs.baremTier).toBeNull();
  });

  it('passes the selection rule without a level conflict', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [
          makeItem({ orderItemId: 'a', listGross: '200.00', unitDesi: '1', quantity: 2 }),
          makeItem({ orderItemId: 'b', listGross: '150.00', unitDesi: '2' }),
        ],
      }),
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        items: [
          makeTrendyolItemAttributes({ orderItemId: 'a' }),
          makeTrendyolItemAttributes({ orderItemId: 'b' }),
        ],
      }),
      reference: trendyolReference(),
      costs: [tryCogs('a', '40.00'), tryCogs('b', '50.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    expect(() => selectLines(result.lines, 'BEST_KNOWN')).not.toThrow();

    const statement = computeProfitStatement({
      lines: result.lines,
      view: 'BEST_KNOWN',
      settings: { includeStopaj: true, includeNegativeNetVat: true },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: result.issues,
    });
    expect(statement.netProfit).not.toBeNull();
  });

  it('records CARRIER_NOT_RECOGNIZED once per parcel even with an accepted return', () => {
    // The outbound and the return leg both write a zero line for a not-recognized carrier,
    // but only the outbound leg records the issue: the parcel carries it exactly once.
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        items: [makeItem({ orderItemId: 'a', listGross: '200.00', unitDesi: '1' })],
      }),
      attributes: makeTrendyolAttributes({
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: trendyolReference({
        shipping: {
          carrier: null,
          orderCarrierOutcome: { kind: 'not-recognized', providerName: 'Alternative Delivery' },
        },
      }),
      costs: [tryCogs('a', '40.00')],
      acceptedReturns: [{ orderItemId: 'a', acceptedQuantity: 1 }],
    });

    expect(result.issues).toEqual([
      {
        code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
        orderItemId: null,
        detail: 'Alternative Delivery',
      },
    ]);
    const shippingLegs = result.lines.filter(
      (line) =>
        line.type === ProfitLineType.SHIPPING || line.type === ProfitLineType.RETURN_SHIPPING,
    );
    expect(shippingLegs.map((line) => line.type)).toEqual([
      ProfitLineType.SHIPPING,
      ProfitLineType.RETURN_SHIPPING,
    ]);
    expect(shippingLegs.map((line) => line.amount.gross.toFixed(2))).toEqual(['0.00', '0.00']);
  });

  it('gives an export parcel no service fee and no stoppage but the international service fee', () => {
    const result = estimateTrendyolParcel({
      snapshot: makeParcel({
        isExportSale: true,
        items: [makeItem({ orderItemId: 'a', listGross: '1000.00', unitDesi: '1' })],
      }),
      attributes: makeTrendyolAttributes({
        items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
      }),
      reference: trendyolReference(),
      costs: [tryCogs('a', '400.00')],
      acceptedReturns: [],
    });

    const types = result.lines.map((line) => line.type);
    expect(types).toContain(ProfitLineType.INTERNATIONAL_SERVICE_FEE);
    expect(types).not.toContain(ProfitLineType.SERVICE_FEE);
    expect(types).not.toContain(ProfitLineType.STOPPAGE);

    const intl = result.lines.find(
      (line) => line.type === ProfitLineType.INTERNATIONAL_SERVICE_FEE,
    );
    expect(intl?.amount.gross.toFixed(2)).toBe('60.00'); // 6% of 1000.00
  });
});
