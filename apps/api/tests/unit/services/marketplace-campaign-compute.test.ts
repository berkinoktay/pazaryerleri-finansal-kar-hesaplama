import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { StoredTariffBand } from '@pazarsync/profit';

import {
  effectiveUnitPrice,
  resolveDiscountCommission,
  sellerEffectivePrice,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from '@/services/discount-math-commons';
import {
  computeCampaignEstimate,
  computeCampaignItem,
  suggestTargetMarginPrices,
  type CampaignTargetMarginItem,
} from '@/services/marketplace-campaign-compute.service';
import {
  createRequestFailureLog,
  type RequestFailureLog,
  type ScreenScenarioBase,
} from '@/services/scenario-screen-commons';

import { makeDiscountScenarioBase } from '../../helpers/scenario-base';

// --- Fixtures (same hand-derivable base as discount-compute.test.ts) ---
//
// Every profit below is hand-derived on the pure scenario base
// (apps/api/tests/helpers/scenario-base.ts): cost 120 gross/unit -> 100 net, a flat 90 net
// shipping per parcel, a 10.99 net PSF per parcel, 1% stoppage, VAT 20 everywhere, and
// settings that include stopaj and negative net VAT (no clamp). So for a sale gross S, order
// quantity n and commission rate r%:
//   saleVat   = round(S / 6)              saleNet = S - saleVat
//   commGross = round(r/100 * S)          commNet = commGross - round(commGross / 6)
//   stoppage  = round(saleNet * 0.01)
//   netProfit = saleNet - commNet - 100*n - 90 - 10.99 - stoppage
// (the n-unit order scales cost by n but keeps ONE shipping and ONE PSF per parcel).

const d = (v: string | number): Decimal => new Decimal(v);

/** The hand-derivable scenario base wrapped as a matched ('ready') screen base. */
const readyBase = (): ScreenScenarioBase => ({ kind: 'ready', base: makeDiscountScenarioBase() });

/** A ready base with no cost profiles -> the engine raises MISSING_COST (NO_COST). */
const noCostBase = (): ScreenScenarioBase => ({
  kind: 'ready',
  base: { ...makeDiscountScenarioBase(), costs: [] },
});

/** One rate at every price -- isolates the matrah from any band movement. */
const openCommission: DiscountCommissionInputs = {
  bands: [{ key: 'all', lowerLimit: null, upperLimit: null, commissionPct: '15' }],
  productRate: null,
  categoryRate: null,
};

/** Nothing resolves -- the chain falls through on every tier. */
const noCommission: DiscountCommissionInputs = {
  bands: null,
  productRate: null,
  categoryRate: null,
};

// --- computeCampaignItem -- the three scenarios ---

describe('computeCampaignItem -- Trendyol funding raises the matrah', () => {
  // The seller enters 1,000 TL, Trendyol's promotion is NET 10% and Trendyol funds 60% of it.
  // Customer pays 900; the SELLER's settlement basis is 1000 - 100 * 0.40 = 960 (Berkin's live
  // rule, design 4.2). Two bands whose boundary sits BETWEEN the two candidate prices: a band
  // read at 900 gives 20%, a band read at 960 gives 10% -- so the rate alone proves which price
  // the chain used.
  const SPLIT_BANDS: StoredTariffBand[] = [
    { key: 'high', lowerLimit: '950', upperLimit: null, commissionPct: '10' },
    { key: 'low', lowerLimit: null, upperLimit: '949.99', commissionPct: '20' },
  ];
  const splitCommission: DiscountCommissionInputs = {
    bands: SPLIT_BANDS,
    productRate: null,
    categoryRate: null,
  };
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('the max scenario matrah is the seller settlement, with the band read from it', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: splitCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });

    // Matrah = sellerEffectivePrice(1000, NET 10%, 60%) = 960 -- NOT the 900 the customer pays.
    expect(out.maxScenario.price.toFixed(2)).toBe('960.00');
    // ...and the commission band was selected from 960 (10%), not from 900 (20%).
    expect(out.maxScenario.commissionSource).toBe('band');
    expect(out.maxScenario.commissionPct).toBe('10.0000');
    // Hand-derived at S=960 / 10%: saleNet 800, commNet 80, stoppage 8 -> 511.01. A reading at
    // the customer-paid 900 / 20% band would give 391.51 (the funding-0 case below), far off.
    expect(out.maxScenario.netProfit).toBe('511.01');
    expect(out.maxScenario.marginPct).toBe('53.23');
  });

  it('the current scenario is campaign-free -- matrah and band are the current price', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: splitCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });
    expect(out.current.price.toFixed(2)).toBe('1000.00');
    expect(out.current.commissionPct).toBe('10.0000'); // 1000 -> >=950 band
    // Hand-derived at S=1000 / 10%.
    expect(out.current.netProfit).toBe('540.68');
  });

  it('at funding 0 the matrah equals the customer-paid price (the Indirimler special case)', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: splitCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(0),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('900.00');
    expect(out.maxScenario.commissionPct).toBe('20.0000'); // 900 -> <950 band
    // Hand-derived at S=900 / 20%.
    expect(out.maxScenario.netProfit).toBe('391.51');
  });

  it('at funding 100 Trendyol absorbs the whole discount -- the matrah is the campaign price', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: splitCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(100),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('1000.00');
    expect(out.maxScenario.netProfit).toBe(out.current.netProfit);
  });
});

describe('computeCampaignItem -- custom price scenario', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('customScenario is null when no custom price is typed', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });
    expect(out.customScenario).toBeNull();
    expect(out.maxScenario.netProfit).not.toBeNull();
    expect(out.current.netProfit).not.toBeNull();
  });

  it('a custom price below the maximum produces its own scenario', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(800),
      config,
      fundingPct: d(60),
    });
    // 800 campaign price -> discount 80 -> seller share 80 * 0.40 = 32 -> matrah 768.
    expect(out.customScenario?.price.toFixed(2)).toBe('768.00');
    // Hand-derived at S=768 / 15%.
    expect(out.customScenario?.netProfit).toBe('336.61');
    // A lower price earns less than the maximum scenario.
    expect(Number(out.customScenario?.netProfit)).toBeLessThan(Number(out.maxScenario.netProfit));
  });
});

describe('computeCampaignItem -- band and matrah come from different prices', () => {
  const bandsAt = (boundary: string, above: string, below: string): DiscountCommissionInputs => {
    const bands: StoredTariffBand[] = [
      { key: 'high', lowerLimit: boundary, upperLimit: null, commissionPct: above },
      {
        key: 'low',
        lowerLimit: null,
        upperLimit: new Decimal(boundary).sub('0.01').toFixed(2),
        commissionPct: below,
      },
    ];
    return { bands, productRate: null, categoryRate: null };
  };

  it('X-al-Y reads the band from the campaign price', () => {
    // 4-al-2-ode @1000, funding 50% -> customer unit 500, seller matrah 1000 - 500 * 0.50 = 750.
    // Band boundary 900: the campaign price (1000) is ABOVE, the matrah (750) is BELOW -- so the
    // rate alone proves which price the band was read from.
    const out = computeCampaignItem({
      base: readyBase(),
      commission: bandsAt('900', '19', '12'),
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(50),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('750.00');
    // The shelf price is unchanged (some units free), so the band is read from 1000 -> 19%;
    // read from 750 it would be 12%.
    expect(out.maxScenario.commissionPct).toBe('19.0000');
    // Hand-derived at S=750 / 19%.
    expect(out.maxScenario.netProfit).toBe('299.01');
  });

  it('NET reads the band from the settlement price, not what the customer pays', () => {
    // NET 50% @1000, funding 60% -> customer 500, seller settlement 1000 - 500 * 0.40 = 800.
    // Band boundary 700: the settlement (800) is ABOVE, the customer price (500) is BELOW.
    const out = computeCampaignItem({
      base: readyBase(),
      commission: bandsAt('700', '19', '12'),
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: { type: 'NET', valueKind: 'PERCENT', value: d(50) },
      fundingPct: d(60),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('800.00');
    expect(out.maxScenario.commissionPct).toBe('19.0000');
    // Hand-derived at S=800 / 19%.
    expect(out.maxScenario.netProfit).toBe('332.34');
  });

  it('NET with no funding drops the band to the discounted price (the band jump is preserved)', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: bandsAt('600', '19', '12'),
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: { type: 'NET', valueKind: 'PERCENT', value: d(50) },
      fundingPct: d(0),
    });
    // 1000 -> discount 500 -> no funding -> matrah 500 -> <600 band -> 12%.
    expect(out.maxScenario.price.toFixed(2)).toBe('500.00');
    expect(out.maxScenario.commissionPct).toBe('12.0000');
    expect(out.current.commissionPct).toBe('19.0000');
  });
});

describe('computeCampaignItem -- order (basket) scenario', () => {
  const buyXPayY: DiscountConfig = { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 };

  it('reports the Trendyol funded amount as its own basket field', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(60),
    });
    // n = buyQuantity = 4; customer unit 500 -> basket paid 2,000; basket total 4 * 1,000 = 4,000;
    // campaign discount 2,000; seller unit 1000 - 500 * 0.40 = 800 -> 3,200;
    // Trendyol funds 3,200 - 2,000 = 1,200 (= 2,000 * 60%).
    expect(out.maxBasket).not.toBeNull();
    expect(out.maxBasket?.assumedQuantity).toBe(4);
    expect(out.maxBasket?.basketTotal).toBe('4000.00');
    expect(out.maxBasket?.basketPaidTotal).toBe('2000.00');
    expect(out.maxBasket?.basketDiscountTotal).toBe('2000.00');
    expect(out.maxBasket?.trendyolFundedTotal).toBe('1200.00');
  });

  it('the order profit is from the SELLER basket settlement, not the customer-paid total', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(60),
    });
    // Hand-derived at the seller settlement order S=3200 / 15% / n=4.
    expect(out.maxBasket?.orderNetProfit).toBe('1739.01');
    // Priced off what the customer paid (2,000) it would be 899.01 -- 840 TL short.
    expect(out.maxBasket?.orderNetProfit).not.toBe('899.01');
    // Margin on the settlement total: 1739.01 / 3200 * 100 -> 54.34.
    expect(out.maxBasket?.orderMarginPct).toBe('54.34');
    // Campaign-free baseline: the same 4 units at the current price (4 * 1,000 = 4,000 / 15%).
    expect(out.maxBasket?.currentOrderNetProfit).toBe('2299.01');
  });

  it('at funding 0 the basket reduces to the plain discount order', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(0),
    });
    expect(out.maxBasket?.assumedQuantity).toBe(4);
    expect(out.maxBasket?.basketTotal).toBe('4000.00');
    expect(out.maxBasket?.basketPaidTotal).toBe('2000.00');
    expect(out.maxBasket?.basketDiscountTotal).toBe('2000.00');
    expect(out.maxBasket?.trendyolFundedTotal).toBe('0.00');
    // At funding 0 the seller settlement equals the customer-paid total (S=2000 / 15% / n=4).
    expect(out.maxBasket?.orderNetProfit).toBe('899.01');
    expect(out.maxBasket?.currentOrderNetProfit).toBe('2299.01');
  });

  it('the custom option basket is built from the CUSTOM price', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      config: buyXPayY,
      fundingPct: d(60),
    });
    // 600 campaign price -> customer unit 300 -> basket 4 * 600 = 2,400, paid 1,200,
    // seller unit 600 - 300 * 0.40 = 480 -> 1,920; funded 1,920 - 1,200 = 720.
    expect(out.customBasket?.assumedQuantity).toBe(4);
    expect(out.customBasket?.basketTotal).toBe('2400.00');
    expect(out.customBasket?.basketPaidTotal).toBe('1200.00');
    expect(out.customBasket?.trendyolFundedTotal).toBe('720.00');
    // Hand-derived at the seller settlement order S=1920 / 15% / n=4.
    expect(out.customBasket?.orderNetProfit).toBe('843.01');
    expect(out.customBasket?.currentOrderNetProfit).toBe('2299.01');
  });

  it('each option basket is built from its own price -- one never replaces the other', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.maxBasket?.basketTotal).toBe('4000.00');
    expect(out.maxBasket?.basketPaidTotal).toBe('2000.00');
    expect(out.maxBasket?.trendyolFundedTotal).toBe('1200.00');
    expect(out.maxBasket?.orderNetProfit).toBe('1739.01');
    expect(out.customBasket?.basketTotal).toBe('2400.00');
    expect(out.customScenario?.price.toFixed(2)).toBe('480.00');
  });

  it('only the max option has a basket when no custom price is typed', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.customScenario).toBeNull();
    expect(out.customBasket).toBeNull();
    expect(out.maxBasket?.basketTotal).toBe('4000.00');
    expect(out.maxBasket?.orderNetProfit).toBe('1739.01');
  });

  it('the basket quantity n derives from the campaign price (ceil(M / P))', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      // Max price 250 -> n = ceil(1000 / 250) = 4 (a current price of 1000 would give n = 1).
      maxPrice: d(250),
      customPrice: null,
      config: {
        type: 'CONDITIONAL_BASKET',
        valueKind: 'AMOUNT',
        value: d(100),
        minBasketAmount: d(1000),
      },
      fundingPct: d(0),
    });
    expect(out.maxBasket?.assumedQuantity).toBe(4);
    expect(out.maxBasket?.basketTotal).toBe('1000.00');
    expect(out.maxBasket?.basketPaidTotal).toBe('900.00');
  });

  it('price-sensitive configs derive each option n from its own price', () => {
    const config: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: d(100),
      minBasketAmount: d(1000),
    };
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(250),
      customPrice: d(200),
      config,
      fundingPct: d(0),
    });
    // 250 -> n = ceil(1000 / 250) = 4; 200 -> n = ceil(1000 / 200) = 5.
    expect(out.maxBasket?.assumedQuantity).toBe(4);
    expect(out.customBasket?.assumedQuantity).toBe(5);
    expect(out.customBasket?.basketTotal).toBe('1000.00');
    expect(out.customBasket?.basketPaidTotal).toBe(
      effectiveUnitPrice(d(200), config).toDecimalPlaces(2).mul(5).toFixed(2),
    );
  });

  it('NET and a non-positive price have no basket scenario', () => {
    const net = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(900),
      config: { type: 'NET', valueKind: 'AMOUNT', value: d(50) },
      fundingPct: d(60),
    });
    expect(net.maxBasket).toBeNull();
    expect(net.customBasket).toBeNull();

    const zero = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(0),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(zero.maxBasket).toBeNull();
  });

  it('leaves the order profit fields null but the money fields populated when the scenario has no commission', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: noCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.maxBasket?.trendyolFundedTotal).toBe('1200.00');
    expect(out.maxBasket?.orderNetProfit).toBeNull();
    expect(out.maxBasket?.orderMarginPct).toBeNull();
    expect(out.maxBasket?.currentOrderNetProfit).toBeNull();
  });
});

describe('computeCampaignItem -- calculability comes from the current scenario', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('returns NO_PRODUCT when the variant did not match', () => {
    const out = computeCampaignItem({
      base: { kind: 'no-product' },
      commission: noCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(800),
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_PRODUCT');
    expect(out.current.netProfit).toBeNull();
    expect(out.maxScenario.netProfit).toBeNull();
    expect(out.customScenario?.netProfit).toBeNull();
  });

  it('returns null reason for a store-wide degrade (already logged), still surfacing the rate', () => {
    const out = computeCampaignItem({
      base: { kind: 'degraded' },
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBeNull();
    expect(out.current.commissionPct).toBe('15.0000');
    expect(out.current.netProfit).toBeNull();
  });

  it('returns NO_COMMISSION when the variant matched but the chain resolves nothing', () => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: noCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
  });

  it('returns NO_COST when the cost is missing', () => {
    const out = computeCampaignItem({
      base: noCostBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COST');
  });
});

// --- computeCampaignEstimate -- one scenario's full breakdown ---

describe('computeCampaignEstimate', () => {
  it('the CURRENT scenario is a UNIT breakdown even on an order-presentation config', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: openCommission,
      price: d(1000),
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: false,
    });
    expect(out.scope).toBe('unit');
    expect(out.basket).toBeNull();
    // No campaign -> no funding -> settlement equals the current price.
    expect(out.price.toFixed(2)).toBe('1000.00');
    // Hand-derived at S=1000 / 15% / n=1.
    expect(out.breakdown?.netProfit).toBe('499.01');
  });

  it('a unit-presentation campaign scenario is the settlement price unit breakdown', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: openCommission,
      price: d(1000),
      currentPrice: d(1000),
      config: { type: 'NET', valueKind: 'PERCENT', value: d(10) },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.scope).toBe('unit');
    expect(out.basket).toBeNull();
    expect(out.price.toFixed(2)).toBe('960.00');
    expect(out.breakdown?.saleGross).toBe('960.00');
    expect(out.commissionPct).toBe('15.0000');
    // Hand-derived at S=960 / 15% / n=1.
    expect(out.breakdown?.netProfit).toBe('471.01');
  });

  it('an order-presentation campaign scenario is an ORDER breakdown (seller settlement)', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: openCommission,
      price: d(1000),
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.scope).toBe('order');
    // Order revenue = the seller basket settlement (4 * 800), NOT what the customer paid (2,000).
    expect(out.price.toFixed(2)).toBe('3200.00');
    expect(out.breakdown?.saleGross).toBe('3200.00');
    expect(out.breakdown?.netProfit).toBe('1739.01');
    // Shipping and PSF count ONCE per parcel (90 net -> 108 gross; 10.99 net -> 13.19 gross).
    expect(out.breakdown?.shippingGross).toBe('108.00');
    expect(out.breakdown?.platformServiceGross).toBe('13.19');
    // Cost scales to 4 units: 120 gross/unit * 4 = 480.
    expect(out.breakdown?.costGross).toBe('480.00');
  });

  it('the order breakdown basket block matches the row card block', () => {
    const config: DiscountConfig = { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 };
    const row = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      config,
      fundingPct: d(60),
    });
    const estimateAt = (price: Decimal): ReturnType<typeof computeCampaignEstimate> =>
      computeCampaignEstimate({
        base: readyBase(),
        commission: openCommission,
        price,
        currentPrice: d(1000),
        config,
        fundingPct: d(60),
        applyCampaign: true,
      });
    const max = estimateAt(d(1000));
    const custom = estimateAt(d(600));
    expect(max.basket).toEqual(row.maxBasket);
    expect(custom.basket).toEqual(row.customBasket);
    // The modal's headline profit IS the block's order profit -- two paths, one figure.
    expect(custom.breakdown?.netProfit).toBe(custom.basket?.orderNetProfit);
  });

  it('a price-sensitive config derives the basket quantity from the scenario price', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: openCommission,
      price: d(250),
      currentPrice: d(1000),
      config: {
        type: 'CONDITIONAL_BASKET',
        valueKind: 'AMOUNT',
        value: d(100),
        minBasketAmount: d(1000),
      },
      fundingPct: d(0),
      applyCampaign: true,
    });
    expect(out.scope).toBe('order');
    expect(out.basket?.assumedQuantity).toBe(4);
    // Cost scales to 4 units: 120 gross/unit * 4 = 480.
    expect(out.breakdown?.costGross).toBe('480.00');
  });

  it('a non-positive price cannot frame a basket -- it falls back to the unit breakdown', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: openCommission,
      price: d(0),
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.scope).toBe('unit');
    expect(out.basket).toBeNull();
  });

  it('an uncalculable item has null breakdown and a reason, but the basket money still fills', () => {
    const out = computeCampaignEstimate({
      base: readyBase(),
      commission: noCommission,
      price: d(1000),
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
    expect(out.breakdown).toBeNull();
    expect(out.scope).toBe('order');
    expect(out.basket?.trendyolFundedTotal).toBe('1200.00');
    expect(out.basket?.orderNetProfit).toBeNull();
  });
});

// --- suggestTargetMarginPrices ---

describe('suggestTargetMarginPrices', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  const silentLog = (): RequestFailureLog =>
    createRequestFailureLog({ surface: 'marketplace-campaign', organizationId: 'org-test' });

  const item = (over: Partial<CampaignTargetMarginItem> = {}): CampaignTargetMarginItem => ({
    itemId: 'i1',
    base: readyBase(),
    commission: openCommission,
    maxPrice: d(1000),
    ...over,
  });

  /** The unit margin the item would actually earn if the seller entered `price`. */
  const marginAt = (price: Decimal, fundingPct: Decimal): number => {
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: price,
      config,
      fundingPct,
    });
    return Number(out.customScenario?.marginPct);
  };

  it('suggests the smallest campaign price that reaches the target', () => {
    const [suggestion] = suggestTargetMarginPrices({
      items: [item()],
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
      failureLog: silentLog(),
    });
    expect(suggestion?.reason).toBeNull();
    expect(suggestion?.price).not.toBeNull();

    const price = d(suggestion?.price ?? '0');
    expect(price.lte(d(1000))).toBe(true);
    // The suggested price reaches the target...
    expect(marginAt(price, d(0))).toBeGreaterThanOrEqual(30);
    // ...and one lira below it does not (genuinely the smallest).
    expect(marginAt(price.sub(1), d(0))).toBeLessThan(30);
  });

  it('a higher funding rate reaches the same target at a lower campaign price', () => {
    const [zeroFunding] = suggestTargetMarginPrices({
      items: [item()],
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
      failureLog: silentLog(),
    });
    const [funded] = suggestTargetMarginPrices({
      items: [item()],
      config,
      fundingPct: d(60),
      targetMarginPct: d(30),
      failureLog: silentLog(),
    });
    expect(funded?.price).not.toBeNull();
    expect(Number(funded?.price)).toBeLessThan(Number(zeroFunding?.price));
    expect(marginAt(d(funded?.price ?? '0'), d(60))).toBeGreaterThanOrEqual(30);
  });

  it('returns UNREACHABLE for a margin no price reaches', () => {
    const [suggestion] = suggestTargetMarginPrices({
      items: [item()],
      config,
      fundingPct: d(0),
      targetMarginPct: d(95),
      failureLog: silentLog(),
    });
    expect(suggestion).toEqual({ itemId: 'i1', price: null, reason: 'UNREACHABLE' });
  });

  it('returns UNREACHABLE when the target needs a settlement above the maximum price', () => {
    const [suggestion] = suggestTargetMarginPrices({
      items: [item({ maxPrice: d(200) })],
      config,
      fundingPct: d(0),
      targetMarginPct: d(50),
      failureLog: silentLog(),
    });
    expect(suggestion).toEqual({ itemId: 'i1', price: null, reason: 'UNREACHABLE' });
  });

  it('returns NOT_CALCULABLE for an unmatched, degraded, missing-cost or no-commission item', () => {
    const out = suggestTargetMarginPrices({
      items: [
        item({ itemId: 'no-product', base: { kind: 'no-product' } }),
        item({ itemId: 'degraded', base: { kind: 'degraded' } }),
        item({ itemId: 'no-cost', base: noCostBase() }),
        item({ itemId: 'no-commission', commission: noCommission }),
      ],
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
      failureLog: silentLog(),
    });
    expect(out).toEqual([
      { itemId: 'no-product', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'degraded', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'no-cost', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'no-commission', price: null, reason: 'NOT_CALCULABLE' },
    ]);
  });

  it('returns one result per item in order and does not mutate the inputs', () => {
    const items = [item({ itemId: 'a' }), item({ itemId: 'b', maxPrice: d(500) })];
    const snapshot = JSON.stringify(items.map((i) => i.maxPrice.toFixed(2)));
    const out = suggestTargetMarginPrices({
      items,
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
      failureLog: silentLog(),
    });
    expect(out.map((s) => s.itemId)).toEqual(['a', 'b']);
    expect(JSON.stringify(items.map((i) => i.maxPrice.toFixed(2)))).toBe(snapshot);
  });
});

describe('suggestTargetMarginPrices -- the suggestion stays safe in a cheaper band', () => {
  // The solve resolves the commission ONCE, from the band at the MAXIMUM price (by design),
  // then finds the smallest campaign price that reaches the target at that fixed rate. When
  // the suggested price is below the maximum and its settlement lands in a CHEAPER band (a
  // lower rate), the row's real scenario earns MORE than it was solved for -- so the
  // suggestion never undershoots the target ("optimistic estimate, settlement reconciles").
  // This two-band ladder gives a lower rate at lower prices to prove it.
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };
  // Boundary 700: a settlement at or above 700 pays 25%, below it pays 8%.
  const LADDER_BANDS: StoredTariffBand[] = [
    { key: 'pricey', lowerLimit: '700', upperLimit: null, commissionPct: '25' },
    { key: 'cheap', lowerLimit: null, upperLimit: '699.99', commissionPct: '8' },
  ];
  const ladderCommission: DiscountCommissionInputs = {
    bands: LADDER_BANDS,
    productRate: null,
    categoryRate: null,
  };
  const silentLog = (): RequestFailureLog =>
    createRequestFailureLog({ surface: 'marketplace-campaign', organizationId: 'org-test' });

  it('a suggestion that drops into a cheaper band still clears the target margin', () => {
    const targetMarginPct = d(20);
    const [suggestion] = suggestTargetMarginPrices({
      items: [
        { itemId: 'ladder', base: readyBase(), commission: ladderCommission, maxPrice: d(1000) },
      ],
      config,
      fundingPct: d(0),
      targetMarginPct,
      failureLog: silentLog(),
    });
    expect(suggestion?.reason).toBeNull();
    expect(suggestion?.price).not.toBeNull();

    const suggestedPrice = d(suggestion?.price ?? '0');
    // The target is reachable well below the ceiling, so the price genuinely dropped.
    expect(suggestedPrice.lt(d(1000))).toBe(true);

    // The row's own scenario, recomputed at exactly the suggested price.
    const row = computeCampaignItem({
      base: readyBase(),
      commission: ladderCommission,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: suggestedPrice,
      config,
      fundingPct: d(0),
    });
    // The solve used the maximum price's band (25%); the suggested price settles into the
    // cheaper band (8%) -- together they prove the price really crossed the boundary.
    expect(row.maxScenario.commissionSource).toBe('band');
    expect(row.maxScenario.commissionPct).toBe('25.0000');
    expect(row.customScenario?.commissionSource).toBe('band');
    expect(row.customScenario?.commissionPct).toBe('8.0000');
    // Safe: the real margin at the suggested price meets (here, exceeds) the target.
    expect(Number(row.customScenario?.marginPct)).toBeGreaterThanOrEqual(
      targetMarginPct.toNumber(),
    );
  });
});

// --- Shared math bridge ---

describe('the campaign scenario derives from the shared math', () => {
  it('the matrah equals sellerEffectivePrice (the formula is not written a second time)', () => {
    const config: DiscountConfig = {
      type: 'NTH_PRODUCT',
      valueKind: 'FIXED_PRICE',
      value: d(10),
      nthIndex: 4,
    };
    const maxPrice = d('374.99');
    const fundingPct = d('37.5');
    const out = computeCampaignItem({
      base: readyBase(),
      commission: openCommission,
      currentPrice: d(400),
      maxPrice,
      customPrice: null,
      config,
      fundingPct,
    });
    expect(out.maxScenario.price.toString()).toBe(
      sellerEffectivePrice(maxPrice, config, fundingPct).toString(),
    );
    // Proof it is not confused with what the customer pays: the two must differ.
    expect(out.maxScenario.price.toString()).not.toBe(
      effectiveUnitPrice(maxPrice, config).toString(),
    );
  });

  it('resolves the band at the 2dp price (it does not fall through the 0.01 gap)', () => {
    // NET 20% @374.99 -> customer 299.992; funding 0 -> settlement also 299.992. Band bounds are
    // 2dp: without rounding to 299.99 it would fall into the gap between 300 and 299.99.
    const BANDS: StoredTariffBand[] = [
      { key: 'band1', lowerLimit: '300', upperLimit: null, commissionPct: '10' },
      { key: 'band2', lowerLimit: '150', upperLimit: '299.99', commissionPct: '12' },
    ];
    const out = computeCampaignItem({
      base: readyBase(),
      commission: { bands: BANDS, productRate: null, categoryRate: null },
      currentPrice: d('374.99'),
      maxPrice: d('374.99'),
      customPrice: null,
      config: { type: 'NET', valueKind: 'PERCENT', value: d(20) },
      fundingPct: d(0),
    });
    expect(out.current.commissionPct).toBe('10.0000');
    expect(out.maxScenario.commissionSource).toBe('band');
    expect(out.maxScenario.commissionPct).toBe('12.0000');
  });

  it('falls through the chain to the product rate, then to the category rate', () => {
    const chain: DiscountCommissionInputs = {
      bands: null,
      productRate: d('21.5'),
      categoryRate: d(19),
    };
    const out = computeCampaignItem({
      base: readyBase(),
      commission: chain,
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      config: { type: 'NET', valueKind: 'PERCENT', value: d(10) },
      fundingPct: d(60),
    });
    expect(out.maxScenario.commissionSource).toBe('product');
    expect(out.maxScenario.commissionPct).toBe('21.5000');
    expect(resolveDiscountCommission(chain, d(960))).toEqual({
      pct: d('21.5'),
      source: 'product',
    });
  });
});
