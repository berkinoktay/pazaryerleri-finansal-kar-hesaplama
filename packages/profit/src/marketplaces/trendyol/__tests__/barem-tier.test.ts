/**
 * Unit tests for the Barem table rules: `resolveTrendyolBaremTier` (the order's
 * promise and ship timing), `selectTrendyolBaremTier` (two-tier versus single-tier
 * tariff versions) and `selectTrendyolReturnBaremTier` (the return leg). No I/O.
 */

import { BaremTier } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import {
  resolveTrendyolBaremTier,
  selectTrendyolBaremTier,
  selectTrendyolReturnBaremTier,
} from '../barem-tier';

// Trendyol's ship-by deadline is Istanbul 23:59 of the promised day (20:59 UTC).
const AGREED = new Date('2026-09-10T20:59:00.000Z');
const BEFORE_AGREED = new Date('2026-09-10T09:15:00.000Z');
const ONE_MS_AFTER_AGREED = new Date(AGREED.getTime() + 1);

const TWO_TIER_BANDS = [
  { tier: BaremTier.TABLE_1 },
  { tier: BaremTier.TABLE_1 },
  { tier: BaremTier.TABLE_2 },
  { tier: BaremTier.TABLE_2 },
];
const SINGLE_TIER_BANDS = [{ tier: BaremTier.TABLE_1 }, { tier: BaremTier.TABLE_1 }];

describe('resolveTrendyolBaremTier', () => {
  it('prices an order without a fast-delivery promise at table 2', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: false,
        agreedDeliveryDate: AGREED,
        actualShipDate: BEFORE_AGREED,
      }),
    ).toEqual({ tier: BaremTier.TABLE_2, shipTiming: 'NOT_PROMISED' });
  });

  it('prices a promised order not yet shipped at table 1', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: null,
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'NOT_SHIPPED' });
  });

  it('prices a promised order with no ship-by date at table 1', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: true,
        agreedDeliveryDate: null,
        actualShipDate: BEFORE_AGREED,
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'NO_DEADLINE' });
  });

  it('prices a promised order shipped before the ship-by date at table 1', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: BEFORE_AGREED,
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'ON_TIME' });
  });

  it('prices a promised order shipped exactly at the ship-by instant at table 1', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: new Date(AGREED.getTime()),
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'ON_TIME' });
  });

  it('prices a promised order shipped one millisecond late at table 2', () => {
    expect(
      resolveTrendyolBaremTier({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: ONE_MS_AFTER_AGREED,
      }),
    ).toEqual({ tier: BaremTier.TABLE_2, shipTiming: 'LATE' });
  });
});

describe('selectTrendyolBaremTier', () => {
  it('applies the promise and ship timing on a two-tier version', () => {
    expect(
      selectTrendyolBaremTier({
        attributes: {
          fastDelivery: true,
          agreedDeliveryDate: AGREED,
          actualShipDate: ONE_MS_AFTER_AGREED,
        },
        baremBands: TWO_TIER_BANDS,
      }),
    ).toEqual({ tier: BaremTier.TABLE_2, shipTiming: 'LATE' });

    expect(
      selectTrendyolBaremTier({
        attributes: { fastDelivery: false, agreedDeliveryDate: null, actualShipDate: null },
        baremBands: TWO_TIER_BANDS,
      }),
    ).toEqual({ tier: BaremTier.TABLE_2, shipTiming: 'NOT_PROMISED' });

    expect(
      selectTrendyolBaremTier({
        attributes: {
          fastDelivery: true,
          agreedDeliveryDate: AGREED,
          actualShipDate: BEFORE_AGREED,
        },
        baremBands: TWO_TIER_BANDS,
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'ON_TIME' });
  });

  it('keeps table 1 for a late fast-delivery order on a single-tier version', () => {
    // The old rule: the promise alone decides; the ship timing is still recorded.
    expect(
      selectTrendyolBaremTier({
        attributes: {
          fastDelivery: true,
          agreedDeliveryDate: AGREED,
          actualShipDate: ONE_MS_AFTER_AGREED,
        },
        baremBands: SINGLE_TIER_BANDS,
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'LATE' });
  });

  it('looks no Barem up for an order without a promise on a single-tier version', () => {
    expect(
      selectTrendyolBaremTier({
        attributes: { fastDelivery: false, agreedDeliveryDate: null, actualShipDate: null },
        baremBands: SINGLE_TIER_BANDS,
      }),
    ).toEqual({ tier: null, shipTiming: 'NOT_PROMISED' });
  });

  it('treats a version without any Barem band as single-tier', () => {
    expect(
      selectTrendyolBaremTier({
        attributes: { fastDelivery: true, agreedDeliveryDate: null, actualShipDate: null },
        baremBands: [],
      }),
    ).toEqual({ tier: BaremTier.TABLE_1, shipTiming: 'NOT_SHIPPED' });
  });
});

describe('selectTrendyolReturnBaremTier', () => {
  it('prices the return at table 1 when the version says so and the order went out at table 1', () => {
    expect(
      selectTrendyolReturnBaremTier({
        appliesToReturns: true,
        outboundBaremTier: BaremTier.TABLE_1,
      }),
    ).toBe(BaremTier.TABLE_1);
  });

  it('looks no Barem up for a return whose order went out at table 2', () => {
    expect(
      selectTrendyolReturnBaremTier({
        appliesToReturns: true,
        outboundBaremTier: BaremTier.TABLE_2,
      }),
    ).toBeNull();
  });

  it('looks no Barem up for a return whose order was not priced at Barem', () => {
    expect(
      selectTrendyolReturnBaremTier({ appliesToReturns: true, outboundBaremTier: null }),
    ).toBeNull();
  });

  it('looks no Barem up when the version does not price returns at Barem', () => {
    expect(
      selectTrendyolReturnBaremTier({
        appliesToReturns: false,
        outboundBaremTier: BaremTier.TABLE_1,
      }),
    ).toBeNull();
  });
});
