import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { buildStoppageLines, buildStoppageRefundLines } from '../stoppage-lines';

const ONE_PERCENT = new Decimal('1');

describe('buildStoppageLines', () => {
  it('builds item stoppage from sale lines', () => {
    const sale = makeLine({
      type: ProfitLineType.SALE,
      gross: '491.28',
      vat: '44.66',
      orderItemId: 'a',
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });

    const lines = buildStoppageLines({
      saleLines: [sale],
      ratePct: ONE_PERCENT,
      isExportSale: false,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe(ProfitLineType.STOPPAGE);
    expect(lines[0]?.level).toBe(ProfitLineLevel.ITEM);
    expect(lines[0]?.orderItemId).toBe('a');
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('4.47');
    expect(lines[0]?.amount.vat.toFixed(2)).toBe('0.00');
    expect(lines[0]?.vatRatePct).toBeNull();
    expect(lines[0]?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(lines[0]?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(lines[0]?.inputs).toEqual({ base: '446.62', ratePct: '1' });
  });

  it('builds no stoppage for an export sale', () => {
    const sale = makeLine({
      type: ProfitLineType.SALE,
      gross: '491.28',
      vat: '44.66',
      orderItemId: 'a',
    });

    expect(
      buildStoppageLines({
        saleLines: [sale],
        ratePct: ONE_PERCENT,
        isExportSale: true,
      }),
    ).toEqual([]);
  });

  it('ignores other line types and skips a zero stoppage', () => {
    const commission = makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '93.34',
      vat: '15.56',
      orderItemId: 'a',
    });
    const tinySale = makeLine({
      type: ProfitLineType.SALE,
      gross: '0.40',
      vat: '0.04',
      orderItemId: 'b',
    });

    expect(
      buildStoppageLines({
        saleLines: [commission, tinySale],
        ratePct: ONE_PERCENT,
        isExportSale: false,
      }),
    ).toEqual([]);
  });
});

describe('buildStoppageRefundLines', () => {
  it('builds stoppage refunds from sale return lines', () => {
    const saleReturn = makeLine({
      type: ProfitLineType.SALE_RETURN,
      gross: '491.28',
      vat: '44.66',
      orderItemId: 'a',
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.MARKETPLACE_RECORD,
    });

    const lines = buildStoppageRefundLines({
      saleReturnLines: [saleReturn],
      ratePct: ONE_PERCENT,
      isExportSale: false,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe(ProfitLineType.STOPPAGE_REFUND);
    expect(lines[0]?.level).toBe(ProfitLineLevel.ITEM);
    expect(lines[0]?.orderItemId).toBe('a');
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('4.47');
    expect(lines[0]?.amount.vat.toFixed(2)).toBe('0.00');
    expect(lines[0]?.vatRatePct).toBeNull();
    expect(lines[0]?.certainty).toBe(ProfitLineCertainty.ACTUAL);
    expect(lines[0]?.source).toBe(ProfitLineSource.MARKETPLACE_RECORD);
    expect(lines[0]?.inputs).toEqual({ base: '446.62', ratePct: '1' });
  });
});
