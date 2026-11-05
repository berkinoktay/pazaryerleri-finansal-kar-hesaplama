import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { StoredTariffBand } from '@pazarsync/profit';

import {
  computeDiscountItem,
  type DiscountBasketScenario,
} from '@/services/discount-compute.service';
import {
  commissionBandPrice,
  effectiveUnitPrice,
  resolveDiscountCommission,
  scenarioPresentation,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from '@/services/discount-math-commons';
import { priceScenario, scenarioNetProfit } from '@/services/discount-scenario-commons';
import { type ScreenScenarioBase } from '@/services/scenario-screen-commons';

import { makeDiscountScenarioBase } from '../../helpers/scenario-base';

const d = (v: string | number): Decimal => new Decimal(v);
const price = (config: DiscountConfig, p: string | number): string =>
  effectiveUnitPrice(d(p), config).toDecimalPlaces(4).toString();

/** The hand-derivable scenario base wrapped as a matched ('ready') screen base. */
const readyBase = (): ScreenScenarioBase => ({ kind: 'ready', base: makeDiscountScenarioBase() });

/** One open band at 15% -- a single rate at every price, so the matrah drives the profit. */
const open15: DiscountCommissionInputs = {
  bands: [{ key: 'all', lowerLimit: null, upperLimit: null, commissionPct: '15' }],
  productRate: null,
  categoryRate: null,
};

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
  it('treats a synced zero rate as unknown and falls through to the category rate', () => {
    // Decision 7 / the 2A rule: a synced product rate of 0 means "not sent", so it never
    // charges a real 0% -- it falls through to the category rate (a 0 band / 0 category stays).
    expect(
      resolveDiscountCommission(
        { bands: null, productRate: new Decimal('0'), categoryRate: new Decimal('19') },
        new Decimal('250'),
      ),
    ).toEqual({ pct: new Decimal('19'), source: 'category' });
    // With no category either, a synced 0 resolves nothing.
    expect(
      resolveDiscountCommission(
        { bands: null, productRate: new Decimal('0'), categoryRate: null },
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
describe('computeDiscountItem -- discounted-scenario band is anchored per type', () => {
  // A product priced 1000 whose discounted unit falls to 500 -- the two prices sit in DIFFERENT
  // bands: >=600 -> 19% (its list-price segment), <600 -> 12%.
  const BANDS: StoredTariffBand[] = [
    { key: 'high', lowerLimit: '600', upperLimit: null, commissionPct: '19' },
    { key: 'low', lowerLimit: null, upperLimit: '599.99', commissionPct: '12' },
  ];
  const commission: DiscountCommissionInputs = {
    bands: BANDS,
    productRate: null,
    categoryRate: null,
  };

  it('NET: discounted scenario uses the DISCOUNTED price band -- the 19->12 jump is preserved', () => {
    const out = computeDiscountItem({
      base: readyBase(),
      commission,
      currentPrice: d(1000),
      config: { type: 'NET', valueKind: 'PERCENT', value: d(50) },
    });
    // 1000 -> high band (19%); effective 500 -> low band (12%).
    expect(out.current.commissionPct).toBe('19.0000');
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.discounted.commissionPct).toBe('12.0000');
  });

  it('BUY_X_PAY_Y (4-al-2-ode @1000): rate from the 1000 band (no jump), matrah stays the 500 effective revenue', () => {
    const out = computeDiscountItem({
      base: readyBase(),
      commission,
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
    });
    // Effective unit = 1000x2/4 = 500 (the matrah/display), but the band comes from the 1000
    // list price -> 19% (identical to the current scenario, so NO transition arrow).
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.current.commissionPct).toBe('19.0000');
    expect(out.discounted.commissionPct).toBe('19.0000');
    // Matrah is the LOWER 500 revenue -- its netProfit must be below the 1000-revenue current
    // scenario. If the 1000 band price had leaked into the matrah they would be equal.
    expect(out.discounted.netProfit).not.toBeNull();
    expect(Number(out.discounted.netProfit)).toBeLessThan(Number(out.current.netProfit));
  });

  it('NTH_PRODUCT (2nd free): same 1000-band anchor, matrah still the 500 effective price', () => {
    const out = computeDiscountItem({
      base: readyBase(),
      commission,
      currentPrice: d(1000),
      config: { type: 'NTH_PRODUCT', valueKind: 'PERCENT', value: d(100), nthIndex: 2 },
    });
    // 2nd unit 100% off -> (1000 + 0)/2 = 500 effective; band from the 1000 list price -> 19%.
    expect(out.discounted.price.toFixed(2)).toBe('500.00');
    expect(out.discounted.commissionPct).toBe('19.0000');
  });
});

describe('computeDiscountItem reason precedence', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };
  // A chain that resolves NOTHING -- no band, no synced rate, no category rate.
  const noCommission: DiscountCommissionInputs = {
    bands: null,
    productRate: null,
    categoryRate: null,
  };

  it('reports NO_PRODUCT (not NO_COMMISSION) for an unmatched row, even when the chain is empty', () => {
    const out = computeDiscountItem({
      base: { kind: 'no-product' },
      commission: noCommission,
      currentPrice: d(100),
      config,
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_PRODUCT');
    // No commission resolved either, so the scenario carries no rate/source.
    expect(out.current.commissionSource).toBeNull();
    expect(out.current.commissionPct).toBeNull();
  });

  it('reports NO_COMMISSION when the variant matched but the chain resolves nothing', () => {
    const out = computeDiscountItem({
      base: readyBase(),
      commission: noCommission,
      currentPrice: d(100),
      config,
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
  });

  it('reports null reason for a store-wide degrade (already logged), still surfacing the band rate', () => {
    // Degraded is checked FIRST, so a matched item under a store-wide load failure reads reason
    // null -- never NO_PRODUCT / NO_COMMISSION -- while the band still resolves for display.
    const out = computeDiscountItem({
      base: { kind: 'degraded' },
      commission: open15,
      currentPrice: d(100),
      config,
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBeNull();
    expect(out.current.commissionPct).toBe('15.0000');
    expect(out.current.netProfit).toBeNull();
  });
});

describe('computeDiscountItem resolves the commission at the 2dp wire price', () => {
  // Touching 2dp band boundaries: band2 covers 150.00-299.99, band1 covers >=300.00. A full-
  // precision discounted price of 299.992 (NET %20 on 374.99) would fall through the 0.01 gap.
  const BANDS: StoredTariffBand[] = [
    { key: 'band1', lowerLimit: '300', upperLimit: null, commissionPct: '10' },
    { key: 'band2', lowerLimit: '150', upperLimit: '299.99', commissionPct: '12' },
  ];

  it('rounds the discounted price to 2dp so it resolves band2 instead of falling through the gap', () => {
    const out = computeDiscountItem({
      base: readyBase(),
      commission: { bands: BANDS, productRate: null, categoryRate: null },
      currentPrice: d('374.99'),
      config: { type: 'NET', valueKind: 'PERCENT', value: d(20) },
    });
    // Current price 374.99 lands in band1 (>=300) at 10%.
    expect(out.current.commissionSource).toBe('band');
    expect(out.current.commissionPct).toBe('10.0000');
    // Discounted 299.992 -> 2dp 299.99 lands in band2 at 12% (NOT null / a chain fall-through).
    expect(out.discounted.price.toFixed(2)).toBe('299.99');
    expect(out.discounted.commissionSource).toBe('band');
    expect(out.discounted.commissionPct).toBe('12.0000');
  });
});

describe('computeDiscountItem rounds the taxed base to the kurus (decision 6)', () => {
  it('prices the matrah at 299.99 (not 299.992) so the engine accepts it and pins the profit', () => {
    // NET %20 on 374.99 -> effective 299.992; the engine's unit price rounds HALF-UP to 299.99
    // (a >2dp price would make the engine throw, so this also proves the row does not drop).
    // Hand-derived at matrah 299.99, open band 15%, on the fixture (cost 120 gross -> 100 net,
    // shipping 90 net, PSF 10.99 net, 1% stoppage, include negative net VAT):
    //   saleGross 299.99; saleVAT round(299.99/6)=50.00 -> saleNet 249.99
    //   commission round(0.15*299.99)=45.00; commVAT round(45/6)=7.50 -> commNet 37.50
    //   stoppage round(249.99*0.01)=2.50
    //   netProfit = 249.99 - 37.50 - 100 - 90 - 10.99 - 2.50 = 9.00
    const out = computeDiscountItem({
      base: readyBase(),
      commission: open15,
      currentPrice: d('374.99'),
      config: { type: 'NET', valueKind: 'PERCENT', value: d(20) },
    });
    expect(out.discounted.price.toFixed(2)).toBe('299.99');
    expect(out.discounted.netProfit).toBe('9.00');
  });
});

describe('computeDiscountItem prices a net-amount discount that reaches the full price', () => {
  it('a NET AMOUNT discount >= the price -> matrah 0, discounted calculable at a loss, row stays', () => {
    // NET -500 TL on 300 -> effective unit 0; the engine accepts 0 TL (Task 1). Hand-derived at
    // matrah 0, open band 15%: the sale is 0, so sale/commission/stoppage are 0 and only the
    // fixture costs deduct: netProfit = 0 - 0 - 100 - 90 - 10.99 - 0 = -200.99; margin null (sale 0).
    const out = computeDiscountItem({
      base: readyBase(),
      commission: open15,
      currentPrice: d(300),
      config: { type: 'NET', valueKind: 'AMOUNT', value: d(500) },
    });
    // The item follows the CURRENT (300) scenario, which is calculable -> the row does not drop.
    expect(out.calculable).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.discounted.price.toFixed(2)).toBe('0.00');
    expect(out.discounted.netProfit).toBe('-200.99');
    expect(out.discounted.marginPct).toBeNull();
  });
});

describe('computeDiscountItem -- basket (order) settlement scenario', () => {
  // No commission resolves on the money-shape cases, so the basket money fields are populated
  // (pure math) while the three order-profit fields stay null -- exactly what these assert.
  const noCommission: DiscountCommissionInputs = {
    bands: null,
    productRate: null,
    categoryRate: null,
  };

  const money = (config: DiscountConfig, currentPrice: number): DiscountBasketScenario | null =>
    computeDiscountItem({
      base: readyBase(),
      commission: noCommission,
      currentPrice: d(currentPrice),
      config,
    }).scenario;

  it('CONDITIONAL_BASKET AMOUNT: n = ceil(M/price), paid = n x discounted unit', () => {
    // M=300, price=199.50, X=50 -> n = ceil(300/199.50) = 2; unit = 199.50 - 50/2 = 174.50.
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
    // M=1000, price=250, X=100 -> n=4; unit = 250 - 100/4 = 225.
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

  it('CONDITIONAL_BASKET PERCENT: n still ceil(M/price), paid = n x the flat percent unit', () => {
    // M=1000, price=250, %20 -> n=4; unit = 250 x 0.8 = 200.
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
    // minQuantity=3, price=100, X=60 -> unit = 100 - 60/3 = 80.
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

  it('BUY_X_PAY_Y: n = buyQuantity, paid = n x (price x pay/buy)', () => {
    // 4 al 2 ode @1000 -> unit = 1000 x 2/4 = 500; n = 4.
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
    // 2nd unit 100% @1000 -> unit = (1000 + 0)/2 = 500; n = 2.
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
    // M=100, price=100, X=500 -> n=1; unit = max(100 - 500, 0) = 0.
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

  it('BUY_X_PAY_Y 3-al-2-ode @1000: engine prices the n-unit order (n cost, one shipping, one PSF)', () => {
    // 3-al-2-ode @1000 -> effective unit 666.6667 -> 2dp 666.67; n = buyQuantity = 3; band from
    // the 1000 list price -> open band 15%. Hand-derived from the fixture (cost 120 gross/unit ->
    // 100 net, scaled n=3 -> 300 net; shipping 90 net ONCE; PSF 10.99 net ONCE; 1% stoppage;
    // include negative net VAT):
    //   DISCOUNTED order saleGross = 666.67x3 = 2000.01
    //     saleVAT round(2000.01/6)=333.34 -> saleNet 1666.67
    //     commission round(0.15*2000.01)=300.00; commVAT round(300/6)=50.00 -> commNet 250.00
    //     stoppage round(1666.67*0.01)=16.67
    //     netProfit = 1666.67 - 250.00 - 300.00 - 90.00 - 10.99 - 16.67 = 999.01
    //     margin 999.01/2000.01*100 = 49.9503% -> 49.95
    //   CURRENT order saleGross = 1000x3 = 3000
    //     saleNet 2500; commission 450 -> commNet 375; stoppage 25
    //     netProfit = 2500 - 375 - 300 - 90 - 10.99 - 25 = 1699.01
    const out = computeDiscountItem({
      base: readyBase(),
      commission: open15,
      currentPrice: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 },
    });
    expect(out.scenario?.assumedQuantity).toBe(3);
    expect(out.scenario?.basketTotal).toBe('3000.00');
    expect(out.scenario?.basketPaidTotal).toBe('2000.01');
    expect(out.scenario?.orderNetProfit).toBe('999.01');
    expect(out.scenario?.orderMarginPct).toBe('49.95');
    expect(out.scenario?.currentOrderNetProfit).toBe('1699.01');
  });

  it('NTH_PRODUCT (2nd free) @1000: order prices n=2 units, band from the 1000 list price', () => {
    // 2nd unit 100% off -> effective unit (1000+0)/2 = 500; n = nthIndex = 2; band from 1000 -> 15%.
    //   DISCOUNTED order saleGross = 500x2 = 1000
    //     saleVAT round(1000/6)=166.67 -> saleNet 833.33
    //     commission round(0.15*1000)=150; commVAT 25 -> commNet 125; stoppage round(8.3333)=8.33
    //     cost 120x2=240 gross -> 200 net; shipping 90 net; PSF 10.99 net
    //     netProfit = 833.33 - 125 - 200 - 90 - 10.99 - 8.33 = 399.01; margin 39.901% -> 39.90
    //   CURRENT order saleGross = 1000x2 = 2000
    //     saleNet 1666.67; commission 300 -> commNet 250; stoppage 16.67
    //     netProfit = 1666.67 - 250 - 200 - 90 - 10.99 - 16.67 = 1099.01
    const out = computeDiscountItem({
      base: readyBase(),
      commission: open15,
      currentPrice: d(1000),
      config: { type: 'NTH_PRODUCT', valueKind: 'PERCENT', value: d(100), nthIndex: 2 },
    });
    expect(out.scenario?.assumedQuantity).toBe(2);
    expect(out.scenario?.basketTotal).toBe('2000.00');
    expect(out.scenario?.basketPaidTotal).toBe('1000.00');
    expect(out.scenario?.orderNetProfit).toBe('399.01');
    expect(out.scenario?.orderMarginPct).toBe('39.90');
    expect(out.scenario?.currentOrderNetProfit).toBe('1099.01');
  });

  it('counts shipping and the platform fee once per basket (order = n x unit + one-off fees)', () => {
    // Inputs with no per-line rounding blur: P=600, rate 15, n=2. saleNet 500, commNet 75,
    // stoppage 5, costNet 100 are all exact and scale by n, so the only difference between the
    // order and n single units is the one-off shipping + PSF: the order keeps ONE 90-net shipping
    // and ONE 10.99-net PSF while 2 units would carry two of each. So
    // orderNetProfit(2) - 2 x unitNetProfit = (2 - 1) x (90 + 10.99) = 100.99.
    const base = readyBase();
    const unit = priceScenario({ base, commission: open15, price: d(600), bandPrice: d(600) });
    const order = priceScenario({
      base,
      commission: open15,
      price: d(600),
      bandPrice: d(600),
      quantity: 2,
    });
    expect(scenarioNetProfit(unit)).not.toBeNull();
    expect(scenarioNetProfit(order)).not.toBeNull();
    const unitNet = new Decimal(scenarioNetProfit(unit) ?? '0');
    const orderNet = new Decimal(scenarioNetProfit(order) ?? '0');
    expect(orderNet.sub(unitNet.mul(2)).toFixed(2)).toBe('100.99');
  });

  it('at n=1 the order equals a single unit -- order profit is the unit net', () => {
    // M=100, price=200 -> n = ceil(100/200) = 1; effective unit = 200 - 50/1 = 150. At n=1 the
    // order scales nothing (cost x1, one parcel), so both order-profit fields equal their unit net.
    const out = computeDiscountItem({
      base: readyBase(),
      commission: open15,
      currentPrice: d(200),
      config: {
        type: 'CONDITIONAL_BASKET',
        valueKind: 'AMOUNT',
        value: d(50),
        minBasketAmount: d(100),
      },
    });
    expect(out.scenario?.assumedQuantity).toBe(1);
    expect(out.discounted.netProfit).not.toBeNull();
    expect(out.scenario?.orderNetProfit).toBe(out.discounted.netProfit);
    expect(out.scenario?.currentOrderNetProfit).toBe(out.current.netProfit);
  });

  it('leaves all three order-profit fields null when a scenario has no commission', () => {
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
