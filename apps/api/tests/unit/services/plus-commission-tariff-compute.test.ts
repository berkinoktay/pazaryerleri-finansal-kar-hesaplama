import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  computePlusItem,
  type PlusItemInputs,
} from '@/services/plus-commission-tariff-compute.service';
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

/**
 * Known inputs: the current scenario is priced at the commission base price (1200 @ 20%),
 * never at the current sale price (960), and the offer at the ceiling (960 @ 10%).
 */
const KNOWN: PlusItemInputs = {
  currentPrice: d(960),
  commissionBasePrice: d(1200),
  currentCommissionPct: d(20),
  plusPriceUpperLimit: d(960),
  plusCommissionPct: d(10),
};

const NULL_CURRENT = { netProfit: null, marginPct: null };

const NULL_OFFER = { price: null, commissionPct: '10', netProfit: null, marginPct: null };

describe('computePlusItem -- known prices (unchanged)', () => {
  it('prices the current scenario at the commission base price and the offer at the ceiling', () => {
    expect(computePlusItem({ inputs: KNOWN, base: readyBase() })).toEqual({
      calculable: true,
      reason: null,
      current: { netProfit: '589.01', marginPct: '49.08' },
      plus: { price: '960.00', commissionPct: '10', netProfit: '511.01', marginPct: '53.23' },
      plusIsBetter: false,
    });
  });

  it('says Plus is better when the offer nets more than the current scenario', () => {
    const out = computePlusItem({
      inputs: {
        ...KNOWN,
        currentPrice: d(600),
        commissionBasePrice: d(600),
        currentCommissionPct: d(10),
      },
      base: readyBase(),
    });

    expect(out.current).toEqual({ netProfit: '244.01', marginPct: '40.67' });
    expect(out.plus.netProfit).toBe('511.01');
    expect(out.plusIsBetter).toBe(true);
  });

  it('reports the current reason and keeps the offer price when the baseline is not calculable', () => {
    expect(computePlusItem({ inputs: KNOWN, base: noCostBase() })).toEqual({
      calculable: false,
      reason: 'NO_COST',
      current: NULL_CURRENT,
      plus: { price: '960.00', commissionPct: '10', netProfit: null, marginPct: null },
      plusIsBetter: false,
    });
  });

  it('keeps reason null for a degraded base and NO_PRODUCT for an unmatched item', () => {
    const offer = { price: '960.00', commissionPct: '10', netProfit: null, marginPct: null };

    expect(computePlusItem({ inputs: KNOWN, base: { kind: 'degraded' } })).toEqual({
      calculable: false,
      reason: null,
      current: NULL_CURRENT,
      plus: offer,
      plusIsBetter: false,
    });
    expect(computePlusItem({ inputs: KNOWN, base: { kind: 'no-product' } })).toEqual({
      calculable: false,
      reason: 'NO_PRODUCT',
      current: NULL_CURRENT,
      plus: offer,
      plusIsBetter: false,
    });
  });
});

describe('computePlusItem -- unknown prices', () => {
  it('falls back to the current price when the commission base price is unknown', () => {
    const out = computePlusItem({
      inputs: { ...KNOWN, currentPrice: d(1200), commissionBasePrice: null },
      base: readyBase(),
    });

    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.current).toEqual({ netProfit: '589.01', marginPct: '49.08' });
  });

  it('returns a null current profit and margin when neither baseline price is known', () => {
    const out = computePlusItem({
      inputs: { ...KNOWN, currentPrice: null, commissionBasePrice: null },
      base: readyBase(),
    });

    expect(out.current).toEqual(NULL_CURRENT);
  });

  it('still computes the offer at the ceiling when the baseline is unknown, and reports it calculable', () => {
    expect(
      computePlusItem({
        inputs: { ...KNOWN, currentPrice: null, commissionBasePrice: null },
        base: readyBase(),
      }),
    ).toEqual({
      calculable: true,
      reason: null,
      current: NULL_CURRENT,
      plus: { price: '960.00', commissionPct: '10', netProfit: '511.01', marginPct: '53.23' },
      plusIsBetter: false,
    });
  });

  it("reports the offer's reason when the baseline is unknown and the offer is not calculable", () => {
    expect(
      computePlusItem({
        inputs: { ...KNOWN, currentPrice: null, commissionBasePrice: null },
        base: noCostBase(),
      }),
    ).toEqual({
      calculable: false,
      reason: 'NO_COST',
      current: NULL_CURRENT,
      plus: { price: '960.00', commissionPct: '10', netProfit: null, marginPct: null },
      plusIsBetter: false,
    });
  });

  it('gives the offer a null price and no profit when the ceiling is unknown, and keeps the current profit', () => {
    expect(
      computePlusItem({
        inputs: { ...KNOWN, plusPriceUpperLimit: null },
        base: readyBase(),
      }),
    ).toEqual({
      calculable: true,
      reason: null,
      current: { netProfit: '589.01', marginPct: '49.08' },
      plus: NULL_OFFER,
      plusIsBetter: false,
    });
  });

  it('reports the current reason with a null offer price when the ceiling is unknown and the baseline is not calculable', () => {
    expect(
      computePlusItem({
        inputs: { ...KNOWN, plusPriceUpperLimit: null },
        base: noCostBase(),
      }),
    ).toEqual({
      calculable: false,
      reason: 'NO_COST',
      current: NULL_CURRENT,
      plus: NULL_OFFER,
      plusIsBetter: false,
    });
  });

  it('never says Plus is better when either price is unknown', () => {
    // With both prices known the offer wins (511.01 against 244.01), so a false below is
    // caused by the unknown price alone.
    const winning: PlusItemInputs = {
      ...KNOWN,
      currentPrice: d(600),
      commissionBasePrice: d(600),
      currentCommissionPct: d(10),
    };
    expect(computePlusItem({ inputs: winning, base: readyBase() }).plusIsBetter).toBe(true);

    const unknownCeiling = computePlusItem({
      inputs: { ...winning, plusPriceUpperLimit: null },
      base: readyBase(),
    });
    expect(unknownCeiling.plusIsBetter).toBe(false);

    const unknownBaseline = computePlusItem({
      inputs: { ...winning, currentPrice: null, commissionBasePrice: null },
      base: readyBase(),
    });
    expect(unknownBaseline.plus.netProfit).toBe('511.01');
    expect(unknownBaseline.plusIsBetter).toBe(false);
  });

  it('is not calculable with a null reason when no price is known', () => {
    expect(
      computePlusItem({
        inputs: {
          ...KNOWN,
          currentPrice: null,
          commissionBasePrice: null,
          plusPriceUpperLimit: null,
        },
        base: readyBase(),
      }),
    ).toEqual({
      calculable: false,
      reason: null,
      current: NULL_CURRENT,
      plus: NULL_OFFER,
      plusIsBetter: false,
    });
  });

  it('keeps reason null for a degraded base and NO_PRODUCT for an unmatched item, with a null offer price when the ceiling is unknown', () => {
    const inputs: PlusItemInputs = { ...KNOWN, plusPriceUpperLimit: null };

    expect(computePlusItem({ inputs, base: { kind: 'degraded' } })).toEqual({
      calculable: false,
      reason: null,
      current: NULL_CURRENT,
      plus: NULL_OFFER,
      plusIsBetter: false,
    });
    expect(computePlusItem({ inputs, base: { kind: 'no-product' } })).toEqual({
      calculable: false,
      reason: 'NO_PRODUCT',
      current: NULL_CURRENT,
      plus: NULL_OFFER,
      plusIsBetter: false,
    });
  });
});
