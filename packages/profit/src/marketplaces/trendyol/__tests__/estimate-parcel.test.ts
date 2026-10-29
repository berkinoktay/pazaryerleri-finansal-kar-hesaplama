import { Decimal } from 'decimal.js';
import { CostProfileType, FxRateMode, ProfitIssueCode, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  makeTrendyolItemAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import { CURRENCY_TRY, toCurrencyCode } from '../../../core/fx/currency-code';
import { InvalidParcelSnapshotError } from '../../../core/parcel-snapshot';
import { computeProfitStatement } from '../../../core/profit-statement';
import { selectLines } from '../../../core/select-lines';
import { type ItemCostInput } from '../../../core/seller-costs/build-seller-cost-lines';
import { estimateTrendyolParcel } from '../estimate-parcel';

/** A single TRY COGS profile for one item, effective well before any order date. */
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
            amountGross: new Decimal(amountGross),
            currency: CURRENCY_TRY,
            vatRatePct: new Decimal('20'),
            fxRateMode: FxRateMode.AUTO,
            manualFxRate: null,
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
      fxQuotes: [],
      acceptedReturns: [],
    });

    expect(result.lines).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.allocation).toEqual({ activeItems: [], returnedItems: [] });
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
      fxQuotes: [],
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
      fxQuotes: [],
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
      fxQuotes: [],
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
      fxQuotes: [],
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
      fxQuotes: [],
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

  it('rejects a parcel whose accounting currency is not TRY', () => {
    expect(() =>
      estimateTrendyolParcel({
        snapshot: makeParcel({
          accountingCurrency: toCurrencyCode('USD'),
          items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
        }),
        attributes: makeTrendyolAttributes({
          items: [makeTrendyolItemAttributes({ orderItemId: 'a' })],
        }),
        reference: trendyolReference(),
        costs: [],
        fxQuotes: [],
        acceptedReturns: [],
      }),
    ).toThrow(InvalidParcelSnapshotError);
  });
});
