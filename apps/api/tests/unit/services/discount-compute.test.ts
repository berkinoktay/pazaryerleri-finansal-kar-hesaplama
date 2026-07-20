import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { EstimateOutcome } from '@pazarsync/profit';

import {
  commissionBandPrice,
  computeDiscountItem,
  effectiveUnitPrice,
  resolveDiscountCommission,
  type DiscountCommissionInputs,
  type DiscountConfig,
  type TariffAssemblyContext,
  type TariffVariant,
} from '@/services/discount-compute.service';
import type { StoredBand } from '@/services/commission-tariff.types';
import { NO_SHIPPING } from '@/services/tariff-compute-commons';
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
  const BANDS: StoredBand[] = [
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
  const BANDS: StoredBand[] = [
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
  const BANDS: StoredBand[] = [
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
