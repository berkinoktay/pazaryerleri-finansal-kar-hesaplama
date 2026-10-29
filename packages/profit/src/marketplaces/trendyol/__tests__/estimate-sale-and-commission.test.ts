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
  makeTrendyolItemAttributes,
  trendyolReference,
} from '../../../__tests__/fixtures/trendyol-reference';
import { estimateCommissionLines, estimateSaleLines } from '../estimate-sale-and-commission';

describe('estimateSaleLines', () => {
  it('builds the melontik sale and commission lines', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '529.00',
          sellerDiscountGross: '37.72',
          saleVatRatePct: '10',
        }),
      ],
    });

    const saleLines = estimateSaleLines(snapshot);
    expect(saleLines).toHaveLength(1);
    expect(saleLines[0]?.type).toBe(ProfitLineType.SALE);
    expect(saleLines[0]?.level).toBe(ProfitLineLevel.ITEM);
    expect(saleLines[0]?.orderItemId).toBe('a');
    expect(saleLines[0]?.amount.gross.toFixed(2)).toBe('491.28');
    expect(saleLines[0]?.amount.vat.toFixed(2)).toBe('44.66');
    expect(saleLines[0]?.vatRatePct?.toString()).toBe('10');
    expect(saleLines[0]?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(saleLines[0]?.source).toBe(ProfitLineSource.RULE);
    expect(saleLines[0]?.fx.source).toBe(FxRateSource.NATIVE);
    expect(saleLines[0]?.inputs).toEqual({ listGross: '529.00', sellerDiscountGross: '37.72' });

    const attributes = makeTrendyolAttributes({
      items: [makeTrendyolItemAttributes({ orderItemId: 'a', orderCommissionRatePct: '19' })],
    });
    const { lines, issues } = estimateCommissionLines({
      snapshot,
      attributes,
      reference: trendyolReference(),
    });
    expect(issues).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe(ProfitLineType.COMMISSION);
    expect(lines[0]?.level).toBe(ProfitLineLevel.ITEM);
    expect(lines[0]?.orderItemId).toBe('a');
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('93.34');
    expect(lines[0]?.amount.vat.toFixed(2)).toBe('15.56');
    expect(lines[0]?.vatRatePct?.toString()).toBe('20');
    expect(lines[0]?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(lines[0]?.source).toBe(ProfitLineSource.RULE);
    expect(lines[0]?.fx.source).toBe(FxRateSource.NATIVE);
    expect(lines[0]?.inputs).toEqual({
      ratePct: '19',
      rateSource: 'ORDER',
      listCommission: '100.51',
      discountCommission: '7.17',
    });
  });

  it('uses zero VAT on the sale of an export parcel', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '20' })],
    });

    const saleLines = estimateSaleLines(snapshot);
    expect(saleLines).toHaveLength(1);
    expect(saleLines[0]?.amount.gross.toFixed(2)).toBe('1000.00');
    expect(saleLines[0]?.amount.vat.toFixed(2)).toBe('0.00');
    expect(saleLines[0]?.vatRatePct?.toString()).toBe('0');
  });

  it('skips cancelled items', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00' }),
        makeItem({ orderItemId: 'b', listGross: '50.00', isCancelled: true }),
      ],
    });

    const saleLines = estimateSaleLines(snapshot);
    expect(saleLines.map((line) => line.orderItemId)).toEqual(['a']);

    const attributes = makeTrendyolAttributes({
      items: [
        makeTrendyolItemAttributes({ orderItemId: 'a', orderCommissionRatePct: '19' }),
        makeTrendyolItemAttributes({ orderItemId: 'b', orderCommissionRatePct: '19' }),
      ],
    });
    const { lines, issues } = estimateCommissionLines({
      snapshot,
      attributes,
      reference: trendyolReference(),
    });
    expect(lines.map((line) => line.orderItemId)).toEqual(['a']);
    expect(issues).toEqual([]);
  });
});

describe('estimateCommissionLines', () => {
  it('rounds the list and discount commissions separately like the settlement', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '10.05',
          sellerDiscountGross: '0.04',
          saleVatRatePct: '20',
        }),
      ],
    });
    const attributes = makeTrendyolAttributes({
      items: [makeTrendyolItemAttributes({ orderItemId: 'a', orderCommissionRatePct: '10' })],
    });

    const { lines, issues } = estimateCommissionLines({
      snapshot,
      attributes,
      reference: trendyolReference(),
    });
    expect(issues).toEqual([]);
    expect(lines).toHaveLength(1);
    // Single rounding of (10.05 - 0.04) * 10% would give 1.00; two-step gives 1.01.
    expect(lines[0]?.amount.gross.toFixed(2)).toBe('1.01');
    expect(lines[0]?.amount.vat.toFixed(2)).toBe('0.17');
    expect(lines[0]?.inputs.listCommission).toBe('1.01');
    expect(lines[0]?.inputs.discountCommission).toBe('0.00');
  });

  it('reports MISSING_COMMISSION_RATE instead of a silent zero', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
    });
    const attributes = makeTrendyolAttributes({
      items: [
        makeTrendyolItemAttributes({
          orderItemId: 'a',
          orderCommissionRatePct: null,
          categoryId: null,
          brandId: null,
        }),
      ],
    });

    const { lines, issues } = estimateCommissionLines({
      snapshot,
      attributes,
      reference: trendyolReference(),
    });
    expect(lines).toEqual([]);
    expect(issues).toEqual([
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: 'a', detail: null },
    ]);
  });

  it('reports MISSING_COMMISSION_RATE when an active item has no attributes', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
    });

    const { lines, issues } = estimateCommissionLines({
      snapshot,
      attributes: makeTrendyolAttributes({ items: [] }),
      reference: trendyolReference(),
    });
    expect(lines).toEqual([]);
    expect(issues).toEqual([
      { code: ProfitIssueCode.MISSING_COMMISSION_RATE, orderItemId: 'a', detail: 'NO_ATTRIBUTES' },
    ]);
  });
});
