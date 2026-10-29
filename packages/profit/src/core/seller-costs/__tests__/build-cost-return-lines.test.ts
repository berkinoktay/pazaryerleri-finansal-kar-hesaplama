import { Decimal } from 'decimal.js';
import {
  CostProfileType,
  FxRateMode,
  FxRateSource,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { toCurrencyCode } from '../../fx/currency-code';
import { type ProfitLine } from '../../profit-line';
import { buildCostReturnLines } from '../build-cost-return-lines';
import { buildSellerCostLines } from '../build-seller-cost-lines';

const USD = toCurrencyCode('USD');

function ratioMap(entries: readonly [string, string][]): ReadonlyMap<string, Decimal> {
  return new Map(entries.map(([orderItemId, ratio]) => [orderItemId, new Decimal(ratio)]));
}

describe('buildCostReturnLines', () => {
  it('returns the accepted share of every cost line', () => {
    const costLines: ProfitLine[] = [
      makeLine({
        type: ProfitLineType.COST_COGS,
        gross: '233.00',
        vat: '21.18',
        orderItemId: 'a',
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.SELLER_INPUT,
      }),
      makeLine({
        type: ProfitLineType.COST_COGS,
        gross: '200.00',
        vat: '33.33',
        orderItemId: 'b',
        certainty: ProfitLineCertainty.ACTUAL,
        source: ProfitLineSource.SELLER_INPUT,
      }),
    ];

    const lines = buildCostReturnLines({
      costLines,
      ratioByItem: ratioMap([
        ['a', '1'],
        ['b', '0.5'],
      ]),
    });

    expect(lines).toHaveLength(2);

    const first = lines[0];
    expect(first?.type).toBe(ProfitLineType.COST_RETURN);
    expect(first?.level).toBe(ProfitLineLevel.ITEM);
    expect(first?.orderItemId).toBe('a');
    expect(first?.amount.gross.toFixed(2)).toBe('233.00');
    expect(first?.amount.vat.toFixed(2)).toBe('21.18');
    expect(first?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(first?.source).toBe(ProfitLineSource.SELLER_INPUT);
    expect(first?.fx.source).toBe(FxRateSource.NATIVE);
    expect(first?.fx.rateDate).toBeNull();
    expect(first?.inputs).toEqual({ returnOf: ProfitLineType.COST_COGS });

    const second = lines[1];
    expect(second?.orderItemId).toBe('b');
    expect(second?.amount.gross.toFixed(2)).toBe('100.00');
    expect(second?.amount.vat.toFixed(2)).toBe('16.67');
    expect(second?.fx.original.gross.toFixed(2)).toBe('100.00');
    expect(second?.fx.original.vat.toFixed(2)).toBe('16.67');
  });

  it('carries the fx conversion with the original amount scaled', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '500', quantity: 2 })],
    });
    const { lines: costLines } = buildSellerCostLines({
      snapshot,
      costs: [
        {
          orderItemId: 'a',
          profiles: [
            {
              profileId: 'p1',
              profileType: CostProfileType.COGS,
              versions: [
                {
                  effectiveFrom: new Date('2026-10-01T00:00:00Z'),
                  amountGross: new Decimal('10.00'),
                  currency: USD,
                  vatRatePct: new Decimal('20'),
                  fxRateMode: FxRateMode.AUTO,
                  manualFxRate: null,
                  archivedAt: null,
                },
              ],
            },
          ],
        },
      ],
      fxQuotes: [{ currency: USD, rateDate: '2026-10-28', rateToBase: new Decimal('41.8') }],
    });
    expect(costLines[0]?.amount.gross.toFixed(2)).toBe('836.00');
    expect(costLines[0]?.amount.vat.toFixed(2)).toBe('139.19');

    const lines = buildCostReturnLines({ costLines, ratioByItem: ratioMap([['a', '0.5']]) });

    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line?.type).toBe(ProfitLineType.COST_RETURN);
    expect(line?.amount.gross.toFixed(2)).toBe('418.00');
    expect(line?.amount.vat.toFixed(2)).toBe('69.60');
    expect(line?.fx.rate.toString()).toBe('41.8');
    expect(line?.fx.rateDate).toBe('2026-10-28');
    expect(line?.fx.source).toBe(FxRateSource.TCMB);
    expect(line?.fx.original.gross.toFixed(2)).toBe('10.00');
    expect(line?.fx.original.vat.toFixed(2)).toBe('1.67');
  });

  it('ignores lines that are not seller cost lines', () => {
    const lines = buildCostReturnLines({
      costLines: [
        makeLine({
          type: ProfitLineType.COMMISSION,
          gross: '93.34',
          vat: '15.56',
          orderItemId: 'a',
        }),
        makeLine({ type: ProfitLineType.SALE, gross: '491.28', vat: '44.66', orderItemId: 'b' }),
        makeLine({
          type: ProfitLineType.COST_RETURN,
          gross: '100.00',
          vat: '16.67',
          orderItemId: 'c',
        }),
      ],
      ratioByItem: ratioMap([
        ['a', '1'],
        ['b', '1'],
        ['c', '1'],
      ]),
    });

    expect(lines).toEqual([]);
  });

  it('skips a return share that rounds to zero', () => {
    const costLines: ProfitLine[] = [
      makeLine({ type: ProfitLineType.COST_COGS, gross: '0.01', vat: '0.00', orderItemId: 'a' }),
    ];

    const lines = buildCostReturnLines({ costLines, ratioByItem: ratioMap([['a', '0.4']]) });

    expect(lines).toEqual([]);
  });

  it('rejects a return ratio above one', () => {
    const costLines: ProfitLine[] = [
      makeLine({ type: ProfitLineType.COST_COGS, gross: '100.00', vat: '16.67', orderItemId: 'a' }),
    ];

    expect(() =>
      buildCostReturnLines({ costLines, ratioByItem: ratioMap([['a', '1.5']]) }),
    ).toThrow(RangeError);
  });
});
