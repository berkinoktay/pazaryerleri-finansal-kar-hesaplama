import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { computeUnitProfit, type EstimateOutcome } from '@pazarsync/profit';

import {
  computeDiscountEstimate,
  computeDiscountItem,
  computeOrderBreakdown,
  type DiscountBasketScenario,
  type TariffAssemblyContext,
  type TariffVariant,
} from '@/services/discount-compute.service';
import {
  assumedBasketQuantity,
  commissionBandPrice,
  effectiveUnitPrice,
  resolveDiscountCommission,
  scenarioPresentation,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from '@/services/discount-math-commons';
import type { StoredTariffBand } from '@pazarsync/profit';
import { assembleUnitEconomics } from '@/services/product-pricing.service';
import { NO_SHIPPING, tariffCommission } from '@/services/tariff-compute-commons';
import type { VariantCostAggregate } from '@/validators/product.validator';

/** An OK cost aggregate + shipping estimate so a scenario resolves to a real breakdown. */
const OK_COST: VariantCostAggregate = { currentCostTry: '100', profileCount: 1, costStatus: 'OK' };
const OK_SHIPPING: EstimateOutcome = {
  ok: true,
  estimate: {
    amount: new Decimal('30'),
    carrierCode: 'SENDEOMP',
    tariffApplied: 'NORMAL',
    sourceTariffId: null,
    baseDesiAtEstimate: new Decimal('1'),
  },
};

const d = (v: string | number): Decimal => new Decimal(v);
const price = (config: DiscountConfig, p: string | number): string =>
  effectiveUnitPrice(d(p), config).toDecimalPlaces(4).toString();

describe('effectiveUnitPrice', () => {
  it('NET amount subtracts, flooring at zero', () => {
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(50) }, 200)).toBe('150');
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(300) }, 200)).toBe('0');
  });

  it('NET percent scales the price', () => {
    expect(price({ type: 'NET', valueKind: 'PERCENT', value: d(20) }, 250)).toBe('200');
  });

  it('CONDITIONAL_BASKET amount splits over the minimum qualifying quantity', () => {
    // min sepet 1000, ürün 250 → n = ceil(1000/250) = 4 adet → birim pay 100/4 = 25.
    const cfg: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: d(100),
      minBasketAmount: d(1000),
    };
    expect(price(cfg, 250)).toBe('225');
    // Ürün min sepeti tek başına aşıyorsa n=1 → indirim tamamen tek birime.
    expect(price(cfg, 1200)).toBe('1100');
  });

  it('CONDITIONAL_BASKET percent equals a flat percent per unit (proportional split)', () => {
    const cfg: DiscountConfig = {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'PERCENT',
      value: d(20),
      minBasketAmount: d(1000),
    };
    expect(price(cfg, 250)).toBe('200');
  });

  it('CONDITIONAL_QUANTITY amount splits over N units, percent stays flat', () => {
    expect(
      price(
        { type: 'CONDITIONAL_QUANTITY', valueKind: 'AMOUNT', value: d(60), minQuantity: 3 },
        100,
      ),
    ).toBe('80');
    expect(
      price(
        { type: 'CONDITIONAL_QUANTITY', valueKind: 'PERCENT', value: d(10), minQuantity: 3 },
        100,
      ),
    ).toBe('90');
  });

  it('BUY_X_PAY_Y scales by payQuantity/buyQuantity', () => {
    expect(price({ type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 }, 100)).toBe('50');
    expect(price({ type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 }, 90)).toBe('60');
  });

  it('NTH_PRODUCT applies the discount to one unit of N', () => {
    // 3. ürüne %50: (2×100 + 50) / 3 = 83.3333
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'PERCENT', value: d(50), nthIndex: 3 }, 100),
    ).toBe('83.3333');
    // 2. ürüne 30 TL indirim: (100 + 70) / 2 = 85; indirim fiyatı aşarsa birim 0'a taban.
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'AMOUNT', value: d(30), nthIndex: 2 }, 100),
    ).toBe('85');
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'AMOUNT', value: d(500), nthIndex: 2 }, 100),
    ).toBe('50');
    // 4. ürün 10 TL (sabit fiyat): (3×100 + 10) / 4 = 77.5
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'FIXED_PRICE', value: d(10), nthIndex: 4 }, 100),
    ).toBe('77.5');
    // Sabit fiyat cari fiyatın ÜSTÜNDEyse birim cari fiyata kısılır (indirim fiyatı yükseltmez):
    // (1×100 + min(100, 150)) / 2 = 100 → indirimli birim cari fiyata eşit.
    expect(
      price({ type: 'NTH_PRODUCT', valueKind: 'FIXED_PRICE', value: d(150), nthIndex: 2 }, 100),
    ).toBe('100');
  });

  it('CODE behaves exactly like CONDITIONAL_BASKET', () => {
    expect(
      price({ type: 'CODE', valueKind: 'AMOUNT', value: d(100), minBasketAmount: d(1000) }, 250),
    ).toBe('225');
    expect(
      price({ type: 'CODE', valueKind: 'PERCENT', value: d(15), minBasketAmount: d(500) }, 200),
    ).toBe('170');
  });

  it('never returns a negative price and passes a zero price through', () => {
    expect(price({ type: 'NET', valueKind: 'PERCENT', value: d(100) }, 250)).toBe('0');
    expect(price({ type: 'NET', valueKind: 'AMOUNT', value: d(10) }, 0)).toBe('0');
    expect(
      price(
        {
          type: 'CONDITIONAL_BASKET',
          valueKind: 'AMOUNT',
          value: d(100),
          minBasketAmount: d(1000),
        },
        0,
      ),
    ).toBe('0');
  });
});

describe('resolveDiscountCommission', () => {
  const BANDS: StoredTariffBand[] = [
    { key: 'band1', lowerLimit: '200', upperLimit: null, commissionPct: '15' },
    { key: 'band2', lowerLimit: null, upperLimit: '200', commissionPct: '18' },
  ];
  it('prefers the tariff band containing the price', () => {
    const out = resolveDiscountCommission(
      { bands: BANDS, productRate: new Decimal('21.5'), categoryRate: new Decimal('19') },
      new Decimal('250'),
    );
    expect(out).toEqual({ pct: new Decimal('15'), source: 'band' });
  });
  it('falls back to the synced product rate when no band matches', () => {
    const out = resolveDiscountCommission(
      { bands: null, productRate: new Decimal('21.5'), categoryRate: new Decimal('19') },
      new Decimal('250'),
    );
    expect(out).toEqual({ pct: new Decimal('21.5'), source: 'product' });
  });
  it('falls back to the category rate last, and to null when nothing resolves', () => {
    expect(
      resolveDiscountCommission(
        { bands: null, productRate: null, categoryRate: new Decimal('19') },
        new Decimal('250'),
      ),
    ).toEqual({ pct: new Decimal('19'), source: 'category' });
    expect(
      resolveDiscountCommission(
        { bands: null, productRate: null, categoryRate: null },
        new Decimal('250'),
      ),
    ).toBeNull();
  });
});

describe('commissionBandPrice — which price selects the band per type', () => {
  const cur = d(1000);
  const disc = d(500);

  it('returns the CURRENT (list) price for BUY_X_PAY_Y and NTH_PRODUCT', () => {
    expect(
      commissionBandPrice(cur, disc, {
        type: 'BUY_X_PAY_Y',
        buyQuantity: 4,
        payQuantity: 2,
      }).toString(),
    ).toBe('1000');
    expect(
      commissionBandPrice(cur, disc, {
        type: 'NTH_PRODUCT',
        valueKind: 'PERCENT',
        value: d(50),
        nthIndex: 3,
      }).toString(),
    ).toBe('1000');
  });

  it('returns the DISCOUNTED effective price for NET / CONDITIONAL_* / CODE', () => {
    expect(
      commissionBandPrice(cur, disc, {
        type: 'NET',
        valueKind: 'PERCENT',
        value: d(50),
      }).toString(),
    ).toBe('500');
    expect(
      commissionBandPrice(cur, disc, {
        type: 'CONDITIONAL_BASKET',
        valueKind: 'PERCENT',
        value: d(20),
        minBasketAmount: d(1000),
      }).toString(),
    ).toBe('500');
    expect(
      commissionBandPrice(cur, disc, {
        type: 'CONDITIONAL_QUANTITY',
        valueKind: 'PERCENT',
        value: d(10),
        minQuantity: 3,
      }).toString(),
    ).toBe('500');
    expect(
      commissionBandPrice(cur, disc, {
        type: 'CODE',
        valueKind: 'PERCENT',
        value: d(15),
        minBasketAmount: d(500),
      }).toString(),
    ).toBe('500');
  });
});

describe('computeDiscountItem — discounted-scenario band is anchored per type', () => {
  const ctx: TariffAssemblyContext = {
    platform: 'TRENDYOL',
    feeDefs: {
      commissionVatRate: new Decimal(20),
      stoppageRate: new Decimal('0.01'),
      psfNet: new Decimal('10.99'),
      psfVatRate: new Decimal(20),
      shipVatRate: new Decimal(20),
    },
  };
  // A product priced 1000 whose discounted unit falls to 500 — the two prices sit in DIFFERENT
  // bands: ≥600 → 19% (its list-price segment), <600 → 12%.
  const variant: TariffVariant = {
    id: 'v1',
    stockCode: 'STK-1',
    barcode: 'BC-1',
    salePrice: new Decimal('1000'),
    vatRate: 20,
    isDigital: false,
    product: { title: 'Ürün', categoryId: null, brandId: null },
  };
  const BANDS: StoredTariffBand[] = [
    { key: 'high', lowerLimit: '600', upperLimit: null, commissionPct: '19' },
    { key: 'low', lowerLimit: null, upperLimit: '599.99', commissionPct: '12' },
  ];
  const commission: DiscountCommissionInputs = {
    bands: BANDS,
    productRate: null,
    categoryRate: null,
  };

  it('NET: discounted scenario uses the DISCOUNTED price band — the %19→%12 jump is preserved', () => {
    const out = computeDiscountItem(ctx, variant, undefined, NO_SHIPPING, commission, d(1000), {
      type: 'NET',
      valueKind: 'PERCENT',
      value: d(50),
    });
    // 1000 → high band (19%); effective 500 → low band (12%).
    expect(out.current.commissionPct).toBe('19.0000');
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.discounted.commissionPct).toBe('12.0000');
  });

  it('BUY_X_PAY_Y (4-al-2-öde @1000): rate from the 1000 band (no jump), matrah stays the 500 effective revenue', () => {
    // OK cost + shipping so BOTH scenarios resolve a breakdown — needed to compare netProfit.
    const out = computeDiscountItem(ctx, variant, OK_COST, OK_SHIPPING, commission, d(1000), {
      type: 'BUY_X_PAY_Y',
      buyQuantity: 4,
      payQuantity: 2,
    });
    // Effective unit = 1000×2/4 = 500 (the matrah/display), but the band comes from the 1000
    // list price → 19% (identical to the current scenario, so NO transition arrow).
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.current.commissionPct).toBe('19.0000');
    expect(out.discounted.commissionPct).toBe('19.0000');
    // Matrah is the LOWER 500 revenue — its netProfit must differ from (be below) the 1000-revenue
    // current scenario. If the 1000 band price had leaked into the matrah they would be equal.
    expect(out.discounted.netProfit).not.toBeNull();
    expect(Number(out.discounted.netProfit)).toBeLessThan(Number(out.current.netProfit));
  });

  it('NTH_PRODUCT (2. ürün bedava): same 1000-band anchor, matrah still the 500 effective price', () => {
    const out = computeDiscountItem(ctx, variant, undefined, NO_SHIPPING, commission, d(1000), {
      type: 'NTH_PRODUCT',
      valueKind: 'PERCENT',
      value: d(100),
      nthIndex: 2,
    });
    // 2. ürün %100 indirim → (1000 + 0)/2 = 500 effective; band from the 1000 list price → 19%.
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.discounted.commissionPct).toBe('19.0000');
  });
});

describe('computeDiscountItem reason precedence', () => {
  const ctx: TariffAssemblyContext = {
    platform: 'TRENDYOL',
    feeDefs: {
      commissionVatRate: new Decimal(20),
      stoppageRate: new Decimal('0.01'),
      psfNet: new Decimal('10.99'),
      psfVatRate: new Decimal(20),
      shipVatRate: new Decimal(20),
    },
  };
  // A chain that resolves NOTHING — no band, no synced rate, no category rate.
  const noCommission: DiscountCommissionInputs = {
    bands: null,
    productRate: null,
    categoryRate: null,
  };
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };
  const variant: TariffVariant = {
    id: 'v1',
    stockCode: 'STK-1',
    barcode: 'BC-1',
    salePrice: new Decimal('100'),
    vatRate: 20,
    isDigital: false,
    product: { title: 'Ürün', categoryId: null, brandId: null },
  };

  it('reports NO_PRODUCT (not NO_COMMISSION) for an unmatched row, even when the chain is empty', () => {
    const out = computeDiscountItem(
      ctx,
      null,
      undefined,
      NO_SHIPPING,
      noCommission,
      d(100),
      config,
    );
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_PRODUCT');
    // No commission resolved either, so the scenario carries no rate/source.
    expect(out.current.commissionSource).toBeNull();
    expect(out.current.commissionPct).toBeNull();
  });

  it('reports NO_COMMISSION when the variant matched but the chain resolves nothing', () => {
    const out = computeDiscountItem(
      ctx,
      variant,
      undefined,
      NO_SHIPPING,
      noCommission,
      d(100),
      config,
    );
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
  });
});

describe('computeDiscountItem resolves the commission at the 2dp wire price', () => {
  const ctx: TariffAssemblyContext = {
    platform: 'TRENDYOL',
    feeDefs: {
      commissionVatRate: new Decimal(20),
      stoppageRate: new Decimal('0.01'),
      psfNet: new Decimal('10.99'),
      psfVatRate: new Decimal(20),
      shipVatRate: new Decimal(20),
    },
  };
  const variant: TariffVariant = {
    id: 'v1',
    stockCode: 'STK-1',
    barcode: 'BC-1',
    salePrice: new Decimal('374.99'),
    vatRate: 20,
    isDigital: false,
    product: { title: 'Ürün', categoryId: null, brandId: null },
  };
  // Touching 2dp band boundaries: band2 covers 150.00–299.99, band1 covers ≥300.00. A full-
  // precision discounted price of 299.992 (NET %20 on 374.99) would fall through the 0.01 gap.
  const BANDS: StoredTariffBand[] = [
    { key: 'band1', lowerLimit: '300', upperLimit: null, commissionPct: '10' },
    { key: 'band2', lowerLimit: '150', upperLimit: '299.99', commissionPct: '12' },
  ];

  it('rounds the discounted price to 2dp so it resolves band2 instead of falling through the gap', () => {
    const out = computeDiscountItem(
      ctx,
      variant,
      undefined,
      NO_SHIPPING,
      { bands: BANDS, productRate: null, categoryRate: null },
      new Decimal('374.99'),
      { type: 'NET', valueKind: 'PERCENT', value: new Decimal(20) },
    );
    // Current price 374.99 lands in band1 (≥300) at 10%.
    expect(out.current.commissionSource).toBe('band');
    expect(out.current.commissionPct).toBe('10.0000');
    // Discounted 299.992 → 2dp 299.99 lands in band2 at 12% (NOT null / a chain fall-through).
    expect(out.discounted.price.toFixed(2)).toBe('299.99');
    expect(out.discounted.commissionSource).toBe('band');
    expect(out.discounted.commissionPct).toBe('12.0000');
  });
});

describe('computeDiscountItem — hakediş (basket settlement) scenario', () => {
  const ctx: TariffAssemblyContext = {
    platform: 'TRENDYOL',
    feeDefs: {
      commissionVatRate: new Decimal(20),
      stoppageRate: new Decimal('0.01'),
      psfNet: new Decimal('10.99'),
      psfVatRate: new Decimal(20),
      shipVatRate: new Decimal(20),
    },
  };
  const variant: TariffVariant = {
    id: 'v1',
    stockCode: 'STK-1',
    barcode: 'BC-1',
    salePrice: new Decimal('1000'),
    vatRate: 20,
    isDigital: false,
    product: { title: 'Ürün', categoryId: null, brandId: null },
  };
  // No commission + no cost — enough for the basket money math, which needs no breakdown; on
  // these cases neither scenario has a breakdown, so all three order-profit fields stay null.
  const noCommission: DiscountCommissionInputs = {
    bands: null,
    productRate: null,
    categoryRate: null,
  };
  // An open band covering every probed price, so BOTH scenarios resolve a breakdown once OK cost +
  // shipping are supplied (the single-parcel order-profit cases below).
  const openCommission: DiscountCommissionInputs = {
    bands: [{ key: 'all', lowerLimit: null, upperLimit: null, commissionPct: '15' }],
    productRate: null,
    categoryRate: null,
  };

  const money = (config: DiscountConfig, currentPrice: number): DiscountBasketScenario | null =>
    computeDiscountItem(ctx, variant, undefined, NO_SHIPPING, noCommission, d(currentPrice), config)
      .scenario;

  it('CONDITIONAL_BASKET AMOUNT: n = ceil(M/price), paid = n × discounted unit', () => {
    // M=300, fiyat=199.50, X=50 → n = ceil(300/199.50) = 2; birim = 199.50 − 50/2 = 174.50.
    expect(
      money(
        { type: 'CONDITIONAL_BASKET', valueKind: 'AMOUNT', value: d(50), minBasketAmount: d(300) },
        199.5,
      ),
    ).toEqual({
      assumedQuantity: 2,
      basketTotal: '399.00',
      basketPaidTotal: '349.00',
      basketDiscountTotal: '50.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
    // M=1000, fiyat=250, X=100 → n=4; birim = 250 − 100/4 = 225.
    expect(
      money(
        {
          type: 'CONDITIONAL_BASKET',
          valueKind: 'AMOUNT',
          value: d(100),
          minBasketAmount: d(1000),
        },
        250,
      ),
    ).toEqual({
      assumedQuantity: 4,
      basketTotal: '1000.00',
      basketPaidTotal: '900.00',
      basketDiscountTotal: '100.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('CONDITIONAL_BASKET PERCENT: n still ceil(M/price), paid = n × the flat percent unit', () => {
    // M=1000, fiyat=250, %20 → n=4; birim = 250 × 0.8 = 200.
    expect(
      money(
        {
          type: 'CONDITIONAL_BASKET',
          valueKind: 'PERCENT',
          value: d(20),
          minBasketAmount: d(1000),
        },
        250,
      ),
    ).toEqual({
      assumedQuantity: 4,
      basketTotal: '1000.00',
      basketPaidTotal: '800.00',
      basketDiscountTotal: '200.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('CODE mirrors CONDITIONAL_BASKET for the scenario too', () => {
    expect(
      money({ type: 'CODE', valueKind: 'AMOUNT', value: d(100), minBasketAmount: d(1000) }, 250),
    ).toEqual({
      assumedQuantity: 4,
      basketTotal: '1000.00',
      basketPaidTotal: '900.00',
      basketDiscountTotal: '100.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('CONDITIONAL_QUANTITY: n = minQuantity', () => {
    // minQuantity=3, fiyat=100, X=60 → birim = 100 − 60/3 = 80.
    expect(
      money(
        { type: 'CONDITIONAL_QUANTITY', valueKind: 'AMOUNT', value: d(60), minQuantity: 3 },
        100,
      ),
    ).toEqual({
      assumedQuantity: 3,
      basketTotal: '300.00',
      basketPaidTotal: '240.00',
      basketDiscountTotal: '60.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('BUY_X_PAY_Y: n = buyQuantity, paid = n × (price × pay/buy)', () => {
    // 4 al 2 öde @1000 → birim = 1000 × 2/4 = 500; n = 4.
    expect(money({ type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 }, 1000)).toEqual({
      assumedQuantity: 4,
      basketTotal: '4000.00',
      basketPaidTotal: '2000.00',
      basketDiscountTotal: '2000.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('NTH_PRODUCT: n = nthIndex', () => {
    // 2. ürün %100 @1000 → birim = (1000 + 0)/2 = 500; n = 2.
    expect(
      money({ type: 'NTH_PRODUCT', valueKind: 'PERCENT', value: d(100), nthIndex: 2 }, 1000),
    ).toEqual({
      assumedQuantity: 2,
      basketTotal: '2000.00',
      basketPaidTotal: '1000.00',
      basketDiscountTotal: '1000.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('NET has no basket scenario (its showcase price genuinely changes)', () => {
    expect(money({ type: 'NET', valueKind: 'AMOUNT', value: d(50) }, 200)).toBeNull();
  });

  it('a non-positive price has no scenario', () => {
    expect(
      money(
        { type: 'CONDITIONAL_BASKET', valueKind: 'AMOUNT', value: d(50), minBasketAmount: d(300) },
        0,
      ),
    ).toBeNull();
  });

  it('floors the paid basket at zero when the amount discount exceeds the basket', () => {
    // M=100, fiyat=100, X=500 → n=1; birim = max(100 − 500, 0) = 0.
    expect(
      money(
        { type: 'CONDITIONAL_BASKET', valueKind: 'AMOUNT', value: d(500), minBasketAmount: d(100) },
        100,
      ),
    ).toEqual({
      assumedQuantity: 1,
      basketTotal: '100.00',
      basketPaidTotal: '0.00',
      basketDiscountTotal: '100.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('runs the real engine over the n-unit order — n× cost, 1× shipping, 1× PSF (PSF no longer counted n times)', () => {
    // 3 al 1 öde @1000 → effective unit = 1000 × 1/3 = 333.3333… → 2dp 333.33; n = buyQuantity = 3.
    // OK cost + shipping + open band resolve a breakdown for BOTH scenarios (band anchored to the
    // 1000 list price → open band 15%). The 2dp effective (333.33) means basketPaidTotal 999.99
    // ≠ 1000 — the order revenue the oracle also prices, so any rounding drift is covered.
    const currentPrice = d(1000);
    const config: DiscountConfig = { type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 1 };
    const out = computeDiscountItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      openCommission,
      currentPrice,
      config,
    );
    const n = 3;
    expect(out.scenario?.assumedQuantity).toBe(n);
    expect(assumedBasketQuantity(config, currentPrice)).toBe(n);

    // basketPaidTotal = the 2dp effective unit × n = 333.33 × 3 = 999.99; basketTotal = 1000 × 3.
    const unit2dp = effectiveUnitPrice(currentPrice, config).toDecimalPlaces(2);
    const basketPaidTotal = unit2dp.mul(n);
    const basketTotal = currentPrice.mul(n);
    expect(out.scenario?.basketPaidTotal).toBe('999.99');
    expect(out.scenario?.basketTotal).toBe('3000.00');

    // Independent oracle: assemble the SAME econ with cost scaled to n and the resolved band rate,
    // then run the engine at the order revenue. Shipping + PSF are the econ's FIXED fees, so the
    // engine counts each exactly ONCE — the order model's core claim. This reconstructs the
    // expected value WITHOUT calling computeOrderBreakdown (the code under test).
    const resolved = resolveDiscountCommission(openCommission, currentPrice);
    if (resolved === null) throw new Error('open band should resolve');
    const scaledCost: VariantCostAggregate = {
      ...OK_COST,
      currentCostTry: new Decimal(OK_COST.currentCostTry ?? '0').mul(n).toString(),
    };
    const orderEcon = assembleUnitEconomics(ctx, variant, {
      costAggregate: scaledCost,
      commission: tariffCommission(resolved.pct),
      shipping: OK_SHIPPING,
    });
    if (orderEcon.econ === null)
      throw new Error('order econ should assemble with OK cost + shipping');
    const oracleDiscounted = computeUnitProfit(orderEcon.econ, basketPaidTotal);
    const oracleCurrent = computeUnitProfit(orderEcon.econ, basketTotal);

    // The scenario's order profits match the independent engine run byte-for-byte (2dp strings).
    expect(out.scenario?.orderNetProfit).toBe(oracleDiscounted.netProfit.toFixed(2));
    expect(out.scenario?.orderMarginPct).toBe(
      oracleDiscounted.saleMarginPct !== null ? oracleDiscounted.saleMarginPct.toFixed(2) : null,
    );
    expect(out.scenario?.currentOrderNetProfit).toBe(oracleCurrent.netProfit.toFixed(2));

    // PSF single-counting proof: the ORDER counts the platform service + shipping ONCE per parcel —
    // the exact single charge a UNIT carries, NOT n× it (the old add-back model triple-counted PSF).
    // Fixed fees are price-independent, so a unit breakdown at ANY price exposes the single charge.
    const unitBreakdown = computeDiscountEstimate(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      openCommission,
      currentPrice,
      currentPrice,
    ).breakdown;
    const orderBreakdown = computeOrderBreakdown(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      resolved,
      n,
      basketPaidTotal,
    );
    expect(orderBreakdown?.platformServiceGross.toFixed(2)).toBe(
      unitBreakdown?.platformServiceGross,
    );
    expect(orderBreakdown?.shippingGross.toFixed(2)).toBe(unitBreakdown?.shippingGross);
    // Cost is the ONLY per-unit line that scales: the order costs 3× a single unit's cost.
    expect(orderBreakdown?.costGross.toFixed(2)).toBe(
      new Decimal(unitBreakdown?.costGross ?? '0').mul(n).toFixed(2),
    );
  });

  it('at n=1 the order equals a single unit — cost×1, one parcel, so order profit is the unit net', () => {
    // M=100, fiyat=200 → n = ceil(100/200) = 1; effective unit = 200 − 50/1 = 150. At n=1 the order
    // scales nothing (cost×1, one parcel), so both order-profit fields equal their unit net exactly.
    const out = computeDiscountItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, d(200), {
      type: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: d(50),
      minBasketAmount: d(100),
    });
    expect(out.scenario?.assumedQuantity).toBe(1);
    expect(out.discounted.netProfit).not.toBeNull();
    expect(out.scenario?.orderNetProfit).toBe(out.discounted.netProfit);
    expect(out.scenario?.currentOrderNetProfit).toBe(out.current.netProfit);
  });

  it('leaves all three order-profit fields null when a scenario has no breakdown', () => {
    // noCommission → neither scenario resolves a breakdown; the basket money fields are still
    // populated but order profit, its margin, and the baseline are all null.
    const scenario = money({ type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 1 }, 357);
    expect(scenario?.orderNetProfit).toBeNull();
    expect(scenario?.orderMarginPct).toBeNull();
    expect(scenario?.currentOrderNetProfit).toBeNull();
  });
});

describe('scenarioPresentation — UNIT vs ORDER per type/valueKind', () => {
  it('UNIT for NET (both kinds) and the conditional trio PERCENT variants', () => {
    expect(scenarioPresentation({ type: 'NET', valueKind: 'AMOUNT', value: d(50) })).toBe('UNIT');
    expect(scenarioPresentation({ type: 'NET', valueKind: 'PERCENT', value: d(20) })).toBe('UNIT');
    expect(
      scenarioPresentation({
        type: 'CONDITIONAL_BASKET',
        valueKind: 'PERCENT',
        value: d(20),
        minBasketAmount: d(1000),
      }),
    ).toBe('UNIT');
    expect(
      scenarioPresentation({
        type: 'CONDITIONAL_QUANTITY',
        valueKind: 'PERCENT',
        value: d(10),
        minQuantity: 3,
      }),
    ).toBe('UNIT');
    expect(
      scenarioPresentation({
        type: 'CODE',
        valueKind: 'PERCENT',
        value: d(15),
        minBasketAmount: d(500),
      }),
    ).toBe('UNIT');
  });

  it('ORDER for the conditional trio AMOUNT variants', () => {
    expect(
      scenarioPresentation({
        type: 'CONDITIONAL_BASKET',
        valueKind: 'AMOUNT',
        value: d(100),
        minBasketAmount: d(1000),
      }),
    ).toBe('ORDER');
    expect(
      scenarioPresentation({
        type: 'CONDITIONAL_QUANTITY',
        valueKind: 'AMOUNT',
        value: d(60),
        minQuantity: 3,
      }),
    ).toBe('ORDER');
    expect(
      scenarioPresentation({
        type: 'CODE',
        valueKind: 'AMOUNT',
        value: d(100),
        minBasketAmount: d(1000),
      }),
    ).toBe('ORDER');
  });

  it('ORDER for BUY_X_PAY_Y and NTH_PRODUCT regardless of valueKind', () => {
    expect(scenarioPresentation({ type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 })).toBe(
      'ORDER',
    );
    expect(
      scenarioPresentation({
        type: 'NTH_PRODUCT',
        valueKind: 'PERCENT',
        value: d(50),
        nthIndex: 3,
      }),
    ).toBe('ORDER');
    expect(
      scenarioPresentation({ type: 'NTH_PRODUCT', valueKind: 'AMOUNT', value: d(30), nthIndex: 2 }),
    ).toBe('ORDER');
    expect(
      scenarioPresentation({
        type: 'NTH_PRODUCT',
        valueKind: 'FIXED_PRICE',
        value: d(10),
        nthIndex: 4,
      }),
    ).toBe('ORDER');
  });
});
