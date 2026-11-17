import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { StoredTariffBand } from '@pazarsync/profit';

import {
  computeFlashEstimate,
  computeFlashItem,
  type FlashEstimateCommission,
  type FlashItemComputeInput,
  type FlashOfferInput,
} from '@/services/flash-product-compute.service';
import { type ScreenScenarioBase } from '@/services/scenario-screen-commons';

import { makeDiscountScenarioBase } from '../../helpers/scenario-base';

// --- Fixtures ---
//
// Every profit below is hand-derived on the pure scenario base
// (apps/api/tests/helpers/scenario-base.ts): cost 120 gross/unit -> 100 net, a flat 90 net
// shipping per parcel, a 10.99 net PSF per parcel, 1% stoppage, VAT 20 everywhere, and
// settings that include stopaj and negative net VAT (no clamp). So for a sale gross S and a
// commission rate r%:
//   saleVat   = round(S / 6)              saleNet = S - saleVat
//   commGross = round(r/100 * S)          commNet = commGross - round(commGross / 6)
//   stoppage  = round(saleNet * 0.01)
//   netProfit = saleNet - commNet - 100 - 90 - 10.99 - stoppage
//   marginPct = netProfit / S
//
//   S=1200, r=15: 1000 - 150 - 100 - 90 - 10.99 - 10 = 639.01, margin 53.25
//   S=960,  r=10:  800 -  80 - 100 - 90 - 10.99 -  8 = 511.01, margin 53.23
//   S=600,  r=15:  500 -  75 - 100 - 90 - 10.99 -  5 = 219.01, margin 36.50

const d = (v: string | number): Decimal => new Decimal(v);

/** The hand-derivable scenario base wrapped as a matched ('ready') screen base. */
const readyBase = (): ScreenScenarioBase => ({ kind: 'ready', base: makeDiscountScenarioBase() });

/** A ready base with no cost profiles -> the engine raises MISSING_COST (NO_COST). */
const noCostBase = (): ScreenScenarioBase => ({
  kind: 'ready',
  base: { ...makeDiscountScenarioBase(), costs: [] },
});

const NOW = new Date('2026-11-17T12:00:00.000Z');

/** A two-band ladder: 960 lands in the 10% band, 600 lands in no band (flat fallback). */
const BANDS: ReadonlyArray<StoredTariffBand> = [
  { key: 'band1', lowerLimit: '1000.00', upperLimit: null, commissionPct: '20' },
  { key: 'band2', lowerLimit: '900.00', upperLimit: '999.99', commissionPct: '10' },
];

const OFFER24_START = new Date('2026-11-17T00:00:00.000Z');
const OFFER24_END = new Date('2026-11-18T00:00:00.000Z');
const OFFER3_START = new Date('2026-11-20T09:00:00.000Z');
const OFFER3_END = new Date('2026-11-20T12:00:00.000Z');

/** The 24h offer: active now, 960 lands in the 10% band. */
const OFFER24_IN_BAND: FlashOfferInput = {
  price: d(960),
  startsAt: OFFER24_START,
  endsAt: OFFER24_END,
  bands: BANDS,
};

/** The 3h offer: upcoming, no commission tariff covers its window -> the flat rate. */
const OFFER3_FLAT: FlashOfferInput = {
  price: d(600),
  startsAt: OFFER3_START,
  endsAt: OFFER3_END,
  bands: null,
};

/** Known flat rate 15%: the current scenario is the customer price 1200 at 15%. */
const KNOWN: FlashItemComputeInput = {
  currentCommissionPct: d(15),
  customerPrice: d(1200),
  offer24: OFFER24_IN_BAND,
  offer3: OFFER3_FLAT,
  primaryBands: BANDS,
};

/** The same item with a blank or unreadable "Mevcut Komisyon" cell. */
const UNKNOWN_FLAT: FlashItemComputeInput = { ...KNOWN, currentCommissionPct: null };

const OFFER24_WINDOW = {
  price: '960.00',
  startsAt: OFFER24_START.toISOString(),
  endsAt: OFFER24_END.toISOString(),
  validity: 'active',
};

const OFFER3_WINDOW = {
  price: '600.00',
  startsAt: OFFER3_START.toISOString(),
  endsAt: OFFER3_END.toISOString(),
  validity: 'upcoming',
};

describe('computeFlashItem -- known flat rate (unchanged)', () => {
  it('prices the current scenario at the flat rate and each offer at its band or the flat rate', () => {
    expect(computeFlashItem({ input: KNOWN, now: NOW, base: readyBase() })).toEqual({
      calculable: true,
      reason: null,
      currentNetProfit: '639.01',
      currentMarginPct: '53.25',
      offer24: {
        ...OFFER24_WINDOW,
        commissionPct: '10.0000',
        netProfit: '511.01',
        marginPct: '53.23',
      },
      offer3: {
        ...OFFER3_WINDOW,
        commissionPct: '15.0000',
        netProfit: '219.01',
        marginPct: '36.50',
      },
      commissionSource: 'band',
      commissionBands: BANDS,
    });
  });
});

describe('computeFlashItem -- unknown flat rate', () => {
  it('returns a null current profit when the flat rate is unknown', () => {
    const out = computeFlashItem({ input: UNKNOWN_FLAT, now: NOW, base: readyBase() });

    expect(out.currentNetProfit).toBeNull();
    expect(out.currentMarginPct).toBeNull();
  });

  it('still computes an offer whose price lands in a tariff band when the flat rate is unknown, and reports the item calculable', () => {
    const out = computeFlashItem({ input: UNKNOWN_FLAT, now: NOW, base: readyBase() });

    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    // The band offer's profit equals the known-flat figure: the flat rate never feeds it.
    expect(out.offer24).toEqual({
      ...OFFER24_WINDOW,
      commissionPct: '10.0000',
      netProfit: '511.01',
      marginPct: '53.23',
    });
    expect(out.commissionSource).toBe('band');
    expect(out.commissionBands).toEqual(BANDS);
  });

  it('gives a flat-fallback offer a null commission and no profit when the flat rate is unknown', () => {
    // Both fallback routes: no covering tariff (bands null) and a price outside every band.
    const outsideBands: FlashOfferInput = { ...OFFER3_FLAT, bands: BANDS };
    const out = computeFlashItem({
      input: { ...UNKNOWN_FLAT, offer24: outsideBands },
      now: NOW,
      base: readyBase(),
    });

    const noProfit = { commissionPct: null, netProfit: null, marginPct: null };
    expect(out.offer24).toEqual({ ...OFFER3_WINDOW, ...noProfit });
    expect(out.offer3).toEqual({ ...OFFER3_WINDOW, ...noProfit });
  });

  it('is not calculable with a null reason when the flat rate is unknown and no offer has a band', () => {
    const input: FlashItemComputeInput = {
      ...UNKNOWN_FLAT,
      offer24: { ...OFFER24_IN_BAND, bands: null },
      primaryBands: null,
    };
    const expected = {
      calculable: false,
      reason: null,
      currentNetProfit: null,
      currentMarginPct: null,
      offer24: { ...OFFER24_WINDOW, commissionPct: null, netProfit: null, marginPct: null },
      offer3: { ...OFFER3_WINDOW, commissionPct: null, netProfit: null, marginPct: null },
      commissionSource: 'current',
      commissionBands: null,
    };

    expect(computeFlashItem({ input, now: NOW, base: readyBase() })).toEqual(expected);
    // Nothing was evaluated, so a missing cost is not reported either.
    expect(computeFlashItem({ input, now: NOW, base: noCostBase() })).toEqual(expected);
  });

  it("reports the band offer's reason when the flat rate is unknown and that offer is not calculable", () => {
    // The 24h offer falls back to the unknown flat rate (not evaluated); the 3h offer
    // lands in a band, so it is the first evaluated offer.
    const input: FlashItemComputeInput = {
      ...UNKNOWN_FLAT,
      offer24: { ...OFFER24_IN_BAND, bands: null },
      offer3: { ...OFFER3_FLAT, price: d(960), bands: BANDS },
    };

    expect(computeFlashItem({ input, now: NOW, base: noCostBase() })).toEqual({
      calculable: false,
      reason: 'NO_COST',
      currentNetProfit: null,
      currentMarginPct: null,
      offer24: { ...OFFER24_WINDOW, commissionPct: null, netProfit: null, marginPct: null },
      offer3: {
        ...OFFER3_WINDOW,
        price: '960.00',
        commissionPct: '10.0000',
        netProfit: null,
        marginPct: null,
      },
      commissionSource: 'band',
      commissionBands: BANDS,
    });
  });
});

describe('computeFlashEstimate -- unknown flat rate', () => {
  const unknownFlat: FlashEstimateCommission = { kind: 'resolve', bands: BANDS, flatPct: null };

  it('estimate: answers not calculable with a null commission when the price falls back to an unknown flat rate', () => {
    const notCalculable = {
      calculable: false,
      reason: null,
      commissionPct: null,
      commissionSource: 'current',
      breakdown: null,
    };

    expect(
      computeFlashEstimate({ base: readyBase(), commission: unknownFlat, price: d(600) }),
    ).toEqual(notCalculable);
    expect(
      computeFlashEstimate({
        base: readyBase(),
        commission: { kind: 'resolve', bands: null, flatPct: null },
        price: d(960),
      }),
    ).toEqual(notCalculable);
    expect(
      computeFlashEstimate({ base: { kind: 'degraded' }, commission: unknownFlat, price: d(600) }),
    ).toEqual(notCalculable);
    // An unmatched item still answers NO_PRODUCT with no commission source.
    expect(
      computeFlashEstimate({
        base: { kind: 'no-product' },
        commission: unknownFlat,
        price: d(600),
      }),
    ).toEqual({
      calculable: false,
      reason: 'NO_PRODUCT',
      commissionPct: null,
      commissionSource: null,
      breakdown: null,
    });
  });

  it('estimate: applies the band rate when the price lands in a band and the flat rate is unknown', () => {
    const out = computeFlashEstimate({ base: readyBase(), commission: unknownFlat, price: d(960) });

    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.commissionPct).toBe('10.0000');
    expect(out.commissionSource).toBe('band');
    expect(out.breakdown?.netProfit).toBe('511.01');
    // Identical to the estimate with the flat rate known: the flat rate never feeds a band price.
    expect(out).toEqual(
      computeFlashEstimate({
        base: readyBase(),
        commission: { kind: 'resolve', bands: BANDS, flatPct: d(15) },
        price: d(960),
      }),
    );
  });
});
