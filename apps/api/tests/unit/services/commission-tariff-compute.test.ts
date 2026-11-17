import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { StoredTariffBand } from '@pazarsync/profit';

import { computeItemBands } from '@/services/commission-tariff-compute.service';
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
//   S=1200, r=20: 1000 - 200 - 100 - 90 - 10.99 - 10 = 589.01, margin 49.08
//   S=960,  r=10:  800 -  80 - 100 - 90 - 10.99 -  8 = 511.01, margin 53.23
//   S=600,  r=10:  500 -  50 - 100 - 90 - 10.99 -  5 = 244.01, margin 40.67

const d = (v: string | number): Decimal => new Decimal(v);

/** The hand-derivable scenario base wrapped as a matched ('ready') screen base. */
const readyBase = (): ScreenScenarioBase => ({ kind: 'ready', base: makeDiscountScenarioBase() });

/** A ready base with no cost profiles -> the engine raises MISSING_COST (NO_COST). */
const noCostBase = (): ScreenScenarioBase => ({
  kind: 'ready',
  base: { ...makeDiscountScenarioBase(), costs: [] },
});

/** Open-topped band 1: priced at its lower limit. */
const BAND_TOP: StoredTariffBand = {
  key: 'band1',
  lowerLimit: '1200',
  upperLimit: null,
  commissionPct: '20',
};
/** Bounded band 2: priced at its upper limit. */
const BAND_MID: StoredTariffBand = {
  key: 'band2',
  lowerLimit: '600.01',
  upperLimit: '960',
  commissionPct: '10',
};
/** Bottom band with no lower limit: priced at its upper limit. */
const BAND_LOW: StoredTariffBand = {
  key: 'band3',
  lowerLimit: null,
  upperLimit: '600',
  commissionPct: '10',
};
/** A band with neither limit: priced at the current price, so it has no price when that is unknown. */
const BAND_OPEN: StoredTariffBand = {
  key: 'open',
  lowerLimit: null,
  upperLimit: null,
  commissionPct: '0',
};

const NULL_CURRENT = { netProfit: null, marginPct: null };

describe('computeItemBands -- unknown baseline price', () => {
  it('evaluates each band at its own limit when the baseline price is unknown', () => {
    const out = computeItemBands({
      bands: [BAND_TOP, BAND_MID, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: readyBase(),
    });

    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.bands).toEqual([
      {
        key: 'band1',
        lowerLimit: '1200',
        upperLimit: null,
        price: '1200.00',
        commissionPct: '20',
        netProfit: '589.01',
        marginPct: '49.08',
      },
      {
        key: 'band2',
        lowerLimit: '600.01',
        upperLimit: '960',
        price: '960.00',
        commissionPct: '10',
        netProfit: '511.01',
        marginPct: '53.23',
      },
      {
        key: 'band3',
        lowerLimit: null,
        upperLimit: '600',
        price: '600.00',
        commissionPct: '10',
        netProfit: '244.01',
        marginPct: '40.67',
      },
    ]);
    expect(out.bestBandKey).toBe('band1');
  });

  it('returns a null current profit and margin when the baseline price is unknown', () => {
    const out = computeItemBands({
      bands: [BAND_TOP, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: readyBase(),
    });

    expect(out.current).toEqual(NULL_CURRENT);
    expect(out.calculable).toBe(true);
  });

  it('gives a band with neither limit a null price and no profit when the current price is unknown', () => {
    const out = computeItemBands({
      bands: [BAND_OPEN, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: readyBase(),
    });

    expect(out.bands).toEqual([
      {
        key: 'open',
        lowerLimit: null,
        upperLimit: null,
        price: null,
        commissionPct: '0',
        netProfit: null,
        marginPct: null,
      },
      {
        key: 'band3',
        lowerLimit: null,
        upperLimit: '600',
        price: '600.00',
        commissionPct: '10',
        netProfit: '244.01',
        marginPct: '40.67',
      },
    ]);
  });

  it('never makes a band with no price the best band', () => {
    // Unknown baseline: only the limited band is evaluated.
    const unknownBaseline = computeItemBands({
      bands: [BAND_OPEN, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: readyBase(),
    });
    expect(unknownBaseline.bestBandKey).toBe('band3');

    // Known baseline (the commission base price) with an unknown current price: the band with
    // neither limit still has no price and is skipped.
    const knownBaseline = computeItemBands({
      bands: [BAND_OPEN, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: d(600),
      currentCommissionPct: d(10),
      base: readyBase(),
    });
    expect(knownBaseline.bestBandKey).toBe('band3');
    expect(knownBaseline.bands).toEqual([
      {
        key: 'open',
        lowerLimit: null,
        upperLimit: null,
        price: null,
        commissionPct: '0',
        netProfit: null,
        marginPct: null,
      },
      {
        key: 'band3',
        lowerLimit: null,
        upperLimit: '600',
        price: '600.00',
        commissionPct: '10',
        netProfit: '244.01',
        marginPct: '40.67',
      },
    ]);
  });

  it('still uses the commission base price as the baseline when only the current price is unknown', () => {
    const out = computeItemBands({
      bands: [BAND_TOP, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: d(600),
      currentCommissionPct: d(10),
      base: readyBase(),
    });

    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.current).toEqual({ netProfit: '244.01', marginPct: '40.67' });
    expect(out.bestBandKey).toBe('band1');
  });

  it("reports the band outcome's reason when no band is calculable and the baseline is unknown", () => {
    const out = computeItemBands({
      bands: [BAND_OPEN, BAND_TOP, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: noCostBase(),
    });

    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COST');
    expect(out.bestBandKey).toBeNull();
    expect(out.current).toEqual(NULL_CURRENT);
    expect(out.bands).toEqual([
      {
        key: 'open',
        lowerLimit: null,
        upperLimit: null,
        price: null,
        commissionPct: '0',
        netProfit: null,
        marginPct: null,
      },
      {
        key: 'band1',
        lowerLimit: '1200',
        upperLimit: null,
        price: '1200.00',
        commissionPct: '20',
        netProfit: null,
        marginPct: null,
      },
      {
        key: 'band3',
        lowerLimit: null,
        upperLimit: '600',
        price: '600.00',
        commissionPct: '10',
        netProfit: null,
        marginPct: null,
      },
    ]);
  });

  it('reports not calculable with a null reason when no band has a price', () => {
    const out = computeItemBands({
      bands: [BAND_OPEN],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
      base: readyBase(),
    });

    expect(out).toEqual({
      calculable: false,
      reason: null,
      bands: [
        {
          key: 'open',
          lowerLimit: null,
          upperLimit: null,
          price: null,
          commissionPct: '0',
          netProfit: null,
          marginPct: null,
        },
      ],
      bestBandKey: null,
      current: NULL_CURRENT,
    });
  });

  it('keeps the degraded and no-product shapes when the current price is unknown', () => {
    const params = {
      bands: [BAND_OPEN, BAND_LOW],
      currentPrice: null,
      commissionBasePrice: null,
      currentCommissionPct: d(20),
    };
    const nullBands = [
      {
        key: 'open',
        lowerLimit: null,
        upperLimit: null,
        price: null,
        commissionPct: '0',
        netProfit: null,
        marginPct: null,
      },
      {
        key: 'band3',
        lowerLimit: null,
        upperLimit: '600',
        price: '600.00',
        commissionPct: '10',
        netProfit: null,
        marginPct: null,
      },
    ];

    expect(computeItemBands({ ...params, base: { kind: 'degraded' } })).toEqual({
      calculable: false,
      reason: null,
      bands: nullBands,
      bestBandKey: null,
      current: NULL_CURRENT,
    });
    expect(computeItemBands({ ...params, base: { kind: 'no-product' } })).toEqual({
      calculable: false,
      reason: 'NO_PRODUCT',
      bands: nullBands,
      bestBandKey: null,
      current: NULL_CURRENT,
    });
  });
});

describe('computeItemBands -- known current price (unchanged)', () => {
  it('prices a band with neither limit at the current price and evaluates it', () => {
    const out = computeItemBands({
      bands: [BAND_OPEN, BAND_LOW],
      currentPrice: d(960),
      commissionBasePrice: null,
      currentCommissionPct: d(10),
      base: readyBase(),
    });

    expect(out.calculable).toBe(true);
    expect(out.current).toEqual({ netProfit: '511.01', marginPct: '53.23' });
    // The open band is evaluated at 960 with its 0% rate: commission 0, so it beats band3.
    expect(out.bands.map((band) => band.price)).toEqual(['960.00', '600.00']);
    expect(out.bestBandKey).toBe('open');
  });

  it('drops every band when the known baseline is not calculable (all-or-none)', () => {
    const out = computeItemBands({
      bands: [BAND_TOP, BAND_LOW],
      currentPrice: d(960),
      commissionBasePrice: null,
      currentCommissionPct: d(10),
      base: noCostBase(),
    });

    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COST');
    expect(out.bestBandKey).toBeNull();
    expect(out.current).toEqual(NULL_CURRENT);
    expect(out.bands.map((band) => band.netProfit)).toEqual([null, null]);
  });
});
