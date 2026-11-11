import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { type ProfitLine } from '../../profit-line';
import { buildCostReturnLines } from '../build-cost-return-lines';

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
    expect(first?.inputs).toEqual({ returnOf: ProfitLineType.COST_COGS });

    const second = lines[1];
    expect(second?.orderItemId).toBe('b');
    expect(second?.amount.gross.toFixed(2)).toBe('100.00');
    expect(second?.amount.vat.toFixed(2)).toBe('16.67');
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
