import {
  FxRateSource,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { InvalidParcelSnapshotError } from '../../../core/parcel-snapshot';
import { type ProfitLine } from '../../../core/profit-line';
import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import { trendyolReference } from '../../../__tests__/fixtures/trendyol-reference';
import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { estimateReturnLines } from '../estimate-returns';

function lineOfType(lines: readonly ProfitLine[], type: ProfitLineType): ProfitLine | undefined {
  return lines.find((line) => line.type === type);
}

describe('estimateReturnLines', () => {
  it('estimates the full domestic return legs', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '491.28', saleVatRatePct: '10', unitDesi: '1' }),
      ],
    });

    const { lines, issues, returnedItems } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [
        makeLine({
          type: ProfitLineType.COMMISSION,
          gross: '93.34',
          vat: '15.56',
          orderItemId: 'a',
        }),
      ],
      costLines: [
        makeLine({
          type: ProfitLineType.COST_COGS,
          gross: '233.00',
          vat: '21.18',
          orderItemId: 'a',
        }),
      ],
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    expect(lines.map((line) => line.type)).toEqual([
      ProfitLineType.SALE_RETURN,
      ProfitLineType.COMMISSION_REFUND,
      ProfitLineType.COST_RETURN,
      ProfitLineType.STOPPAGE_REFUND,
      ProfitLineType.RETURN_SHIPPING,
    ]);

    const saleReturn = lineOfType(lines, ProfitLineType.SALE_RETURN);
    expect(saleReturn?.level).toBe(ProfitLineLevel.ITEM);
    expect(saleReturn?.orderItemId).toBe('a');
    expect(saleReturn?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(saleReturn?.source).toBe(ProfitLineSource.RULE);
    expect(saleReturn?.fx.source).toBe(FxRateSource.NATIVE);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('491.28');
    expect(saleReturn?.amount.vat.toFixed(2)).toBe('44.66');
    expect(saleReturn?.vatRatePct?.toString()).toBe('10');

    const commissionRefund = lineOfType(lines, ProfitLineType.COMMISSION_REFUND);
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('93.34');
    expect(commissionRefund?.amount.vat.toFixed(2)).toBe('15.56');

    const costReturn = lineOfType(lines, ProfitLineType.COST_RETURN);
    expect(costReturn?.amount.gross.toFixed(2)).toBe('233.00');
    expect(costReturn?.amount.vat.toFixed(2)).toBe('21.18');

    const stoppageRefund = lineOfType(lines, ProfitLineType.STOPPAGE_REFUND);
    expect(stoppageRefund?.orderItemId).toBe('a');
    expect(stoppageRefund?.amount.gross.toFixed(2)).toBe('4.47');
    expect(stoppageRefund?.amount.vat.toFixed(2)).toBe('0.00');

    const returnShipping = lineOfType(lines, ProfitLineType.RETURN_SHIPPING);
    expect(returnShipping?.level).toBe(ProfitLineLevel.PARCEL);
    expect(returnShipping?.orderItemId).toBeNull();
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
    expect(returnShipping?.amount.vat.toFixed(2)).toBe('15.51');
    expect(returnShipping?.inputs).toEqual({
      desi: '1',
      tariffKind: 'DESI',
      carrierCode: 'TEXMP',
    });

    expect(returnedItems).toHaveLength(1);
    expect(returnedItems[0]?.orderItemId).toBe('a');
    expect(returnedItems[0]?.saleGross.toFixed(2)).toBe('491.28');
    expect(returnedItems[0]?.standaloneAmount?.toFixed(2)).toBe('93.05');
  });

  it('does not apply Barem to the return shipping even for a fast-delivery basket', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { lines } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    // desi 2 -> key '2' -> net 77.54 -> gross 93.05, NOT the in-band Barem price.
    const returnShipping = lineOfType(lines, ProfitLineType.RETURN_SHIPPING);
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
    expect(returnShipping?.inputs.tariffKind).toBe('DESI');
  });

  it('prorates a partial return', () => {
    // Review focus 4: the return legs scale by the accepted quantity ratio.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '200.00', unitDesi: '1', quantity: 2 })],
    });

    const { lines } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    const saleReturn = lineOfType(lines, ProfitLineType.SALE_RETURN);
    expect(saleReturn?.amount.gross.toFixed(2)).toBe('100.00');
  });

  it('refunds only the accepted share of the effective commission', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '200.00', unitDesi: '1', quantity: 2 })],
    });

    const { lines } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [
        makeLine({
          type: ProfitLineType.COMMISSION,
          gross: '40.00',
          vat: '6.67',
          orderItemId: 'a',
        }),
      ],
      costLines: [],
      reference: trendyolReference(),
    });

    const commissionRefund = lineOfType(lines, ProfitLineType.COMMISSION_REFUND);
    expect(commissionRefund?.amount.gross.toFixed(2)).toBe('20.00');
    expect(commissionRefund?.inputs.ratio).toBe('0.5');
  });

  it('lists only the returned items for return-leg allocation', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '491.28', saleVatRatePct: '10', unitDesi: '1' }),
        makeItem({ orderItemId: 'b', listGross: '380.47', saleVatRatePct: '10', unitDesi: '3' }),
      ],
    });

    const { lines, returnedItems } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    expect(returnedItems).toHaveLength(1);
    expect(returnedItems[0]?.orderItemId).toBe('a');
    expect(returnedItems[0]?.saleGross.toFixed(2)).toBe('491.28');
    expect(returnedItems[0]?.standaloneAmount?.toFixed(2)).toBe('93.05');

    const returnShipping = lineOfType(lines, ProfitLineType.RETURN_SHIPPING);
    expect(returnShipping?.inputs.desi).toBe('1');
    expect(returnShipping?.amount.gross.toFixed(2)).toBe('93.05');
  });

  it('charges the overseas return operation fee instead on an export parcel', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '20' }),
        makeItem({ orderItemId: 'b', listGross: '2500.00', saleVatRatePct: '20' }),
      ],
    });

    const { lines, returnedItems } = estimateReturnLines({
      snapshot,
      accepted: [
        { orderItemId: 'a', acceptedQuantity: 1 },
        { orderItemId: 'b', acceptedQuantity: 1 },
      ],
      commissionLines: [
        makeLine({ type: ProfitLineType.COMMISSION, gross: '190.00', orderItemId: 'a' }),
        makeLine({ type: ProfitLineType.COMMISSION, gross: '475.00', orderItemId: 'b' }),
      ],
      costLines: [],
      reference: trendyolReference(),
    });

    expect(lines.map((line) => line.type)).toEqual([
      ProfitLineType.INTERNATIONAL_OPERATION_FEE,
      ProfitLineType.INTERNATIONAL_OPERATION_FEE,
    ]);

    const first = lines[0];
    expect(first?.level).toBe(ProfitLineLevel.ITEM);
    expect(first?.orderItemId).toBe('a');
    expect(first?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(first?.source).toBe(ProfitLineSource.RULE);
    expect(first?.amount.gross.toFixed(2)).toBe('283.50');
    expect(first?.amount.vat.toFixed(2)).toBe('0.00');
    expect(first?.vatRatePct?.toString()).toBe('0');
    expect(first?.inputs).toEqual({ ratePct: '35', vatAssumption: 'ZERO' });

    const second = lines[1];
    expect(second?.orderItemId).toBe('b');
    expect(second?.amount.gross.toFixed(2)).toBe('607.50');
    expect(second?.inputs).toEqual({ ratePct: '30', vatAssumption: 'ZERO' });

    expect(returnedItems).toHaveLength(2);
    expect(returnedItems[0]?.saleGross.toFixed(2)).toBe('1000.00');
    expect(returnedItems[0]?.standaloneAmount).toBeNull();
    expect(returnedItems[1]?.saleGross.toFixed(2)).toBe('2500.00');
    expect(returnedItems[1]?.standaloneAmount).toBeNull();
  });

  it('rounds the unit sale before the tier lookup', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '4000.01', saleVatRatePct: '20', quantity: 2 }),
      ],
    });

    const { lines } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 2 }],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    // unit = roundMoney(4000.01 / 2) = 2000.01 -> the 30% tier, no throw.
    const fee = lineOfType(lines, ProfitLineType.INTERNATIONAL_OPERATION_FEE);
    expect(fee?.inputs.ratePct).toBe('30');
    expect(fee?.amount.gross.toFixed(2)).toBe('1200.00');
  });

  it('reports an unknown return desi', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: null })],
    });

    const { lines, issues, returnedItems } = estimateReturnLines({
      snapshot,
      accepted: [{ orderItemId: 'a', acceptedQuantity: 1 }],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    expect(lineOfType(lines, ProfitLineType.RETURN_SHIPPING)).toBeUndefined();
    expect(lineOfType(lines, ProfitLineType.SALE_RETURN)?.amount.gross.toFixed(2)).toBe('100.00');
    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'RETURN_UNKNOWN_DESI',
      },
    ]);
    expect(returnedItems[0]?.standaloneAmount).toBeNull();
  });

  it('returns nothing when no return is accepted', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '1' })],
    });

    const result = estimateReturnLines({
      snapshot,
      accepted: [],
      commissionLines: [],
      costLines: [],
      reference: trendyolReference(),
    });

    expect(result).toEqual({ lines: [], issues: [], returnedItems: [] });
  });

  it('rejects an accepted quantity above the item quantity', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '1', quantity: 1 })],
    });

    expect(() =>
      estimateReturnLines({
        snapshot,
        accepted: [{ orderItemId: 'a', acceptedQuantity: 2 }],
        commissionLines: [],
        costLines: [],
        reference: trendyolReference(),
      }),
    ).toThrow(InvalidParcelSnapshotError);
  });
});
