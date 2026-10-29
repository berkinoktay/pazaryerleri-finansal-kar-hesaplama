import { ProfitLineLevel, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import { trendyolReference } from '../../../__tests__/fixtures/trendyol-reference';
import { estimateInternationalServiceLine } from '../estimate-export-fees';

const fees = trendyolReference().fees;

describe('estimateInternationalServiceLine', () => {
  it('charges 6% of the parcel sale once on an export parcel', () => {
    const multiItem = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '0' }),
        makeItem({ orderItemId: 'b', listGross: '491.28', saleVatRatePct: '0' }),
      ],
    });

    const line = estimateInternationalServiceLine({ snapshot: multiItem, fees });
    expect(line).not.toBeNull();
    expect(line?.type).toBe(ProfitLineType.INTERNATIONAL_SERVICE_FEE);
    expect(line?.level).toBe(ProfitLineLevel.PARCEL);
    expect(line?.orderItemId).toBeNull();
    expect(line?.amount.gross.toFixed(2)).toBe('89.48');
    expect(line?.amount.vat.toFixed(2)).toBe('14.91');
    expect(line?.inputs).toEqual({ base: '1491.28', ratePct: '6' });

    const singleItem = makeParcel({
      isExportSale: true,
      items: [makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '0' })],
    });

    const singleLine = estimateInternationalServiceLine({ snapshot: singleItem, fees });
    expect(singleLine?.amount.gross.toFixed(2)).toBe('60.00');
    expect(singleLine?.amount.vat.toFixed(2)).toBe('10.00');
    expect(singleLine?.inputs).toEqual({ base: '1000.00', ratePct: '6' });
  });

  it('charges nothing on a domestic parcel', () => {
    const snapshot = makeParcel({
      isExportSale: false,
      items: [makeItem({ orderItemId: 'a', listGross: '1000.00' })],
    });

    expect(estimateInternationalServiceLine({ snapshot, fees })).toBeNull();
  });

  it('leaves cancelled items out of the base', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({ orderItemId: 'a', listGross: '1000.00', saleVatRatePct: '0' }),
        makeItem({ orderItemId: 'b', listGross: '491.28', saleVatRatePct: '0', isCancelled: true }),
      ],
    });

    const line = estimateInternationalServiceLine({ snapshot, fees });
    expect(line?.amount.gross.toFixed(2)).toBe('60.00');
    expect(line?.inputs).toEqual({ base: '1000.00', ratePct: '6' });
  });

  it('charges nothing when every item is cancelled', () => {
    const snapshot = makeParcel({
      isExportSale: true,
      items: [
        makeItem({
          orderItemId: 'a',
          listGross: '1000.00',
          saleVatRatePct: '0',
          isCancelled: true,
        }),
      ],
    });

    expect(estimateInternationalServiceLine({ snapshot, fees })).toBeNull();
  });
});
