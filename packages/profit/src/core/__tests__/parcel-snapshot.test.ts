import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../__tests__/fixtures/parcel-builders';
import {
  activeItems,
  assertAcceptedReturns,
  assertParcelSnapshot,
  InvalidParcelSnapshotError,
} from '../parcel-snapshot';

describe('assertParcelSnapshot', () => {
  it('accepts a valid parcel', () => {
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100' })] }),
      ),
    ).not.toThrow();
  });

  it('rejects a business date that does not match the order date in Istanbul', () => {
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ orderDate: new Date('2026-10-28T22:30:00Z'), businessDate: '2026-10-28' }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('rejects a sale that is not list minus seller discount', () => {
    // Review focus 2: a customer-paid amount that also deducts a marketplace-funded discount
    expect(() =>
      assertParcelSnapshot(
        makeParcel({
          items: [
            makeItem({
              orderItemId: 'a',
              listGross: '529.00',
              sellerDiscountGross: '37.72',
              saleGross: '480.00',
            }),
          ],
        }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('rejects a non-integer or zero quantity', () => {
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100', quantity: 0 })] }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100', quantity: 1.5 })] }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('rejects money with more than two decimals and duplicate item ids', () => {
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '1.005' })] }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
    expect(() =>
      assertParcelSnapshot(
        makeParcel({
          items: [
            makeItem({ orderItemId: 'a', listGross: '100' }),
            makeItem({ orderItemId: 'a', listGross: '100' }),
          ],
        }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('rejects a negative unit desi', () => {
    expect(() =>
      assertParcelSnapshot(
        makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100', unitDesi: '-1' })] }),
      ),
    ).toThrow(InvalidParcelSnapshotError);
  });

  it('activeItems drops cancelled lines', () => {
    const parcel = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100' }),
        makeItem({ orderItemId: 'b', listGross: '100', isCancelled: true }),
      ],
    });
    expect(activeItems(parcel).map((item) => item.orderItemId)).toEqual(['a']);
  });
});

describe('assertAcceptedReturns', () => {
  it('accepts a partial return of an active item', () => {
    const parcel = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100', quantity: 2 })],
    });
    expect(() =>
      assertAcceptedReturns(parcel, [{ orderItemId: 'a', acceptedQuantity: 1 }]),
    ).not.toThrow();
  });

  it('rejects a return beyond the quantity, of an unknown or cancelled item, or listed twice', () => {
    const parcel = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100', quantity: 2 }),
        makeItem({ orderItemId: 'c', listGross: '100', isCancelled: true }),
      ],
    });
    // beyond the accepted quantity
    expect(() =>
      assertAcceptedReturns(parcel, [{ orderItemId: 'a', acceptedQuantity: 3 }]),
    ).toThrow(InvalidParcelSnapshotError);
    // unknown item
    expect(() =>
      assertAcceptedReturns(parcel, [{ orderItemId: 'zzz', acceptedQuantity: 1 }]),
    ).toThrow(InvalidParcelSnapshotError);
    // cancelled item
    expect(() =>
      assertAcceptedReturns(parcel, [{ orderItemId: 'c', acceptedQuantity: 1 }]),
    ).toThrow(InvalidParcelSnapshotError);
    // listed twice
    expect(() =>
      assertAcceptedReturns(parcel, [
        { orderItemId: 'a', acceptedQuantity: 1 },
        { orderItemId: 'a', acceptedQuantity: 1 },
      ]),
    ).toThrow(InvalidParcelSnapshotError);
  });
});
