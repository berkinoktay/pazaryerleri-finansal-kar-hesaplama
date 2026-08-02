import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { computeUnitProfit, type EstimateOutcome } from '@pazarsync/profit';

import { computeDiscountItem } from '@/services/discount-compute.service';
import {
  effectiveUnitPrice,
  resolveDiscountCommission,
  sellerEffectivePrice,
  type DiscountCommissionInputs,
  type DiscountConfig,
} from '@/services/discount-math-commons';
import type { StoredBand } from '@/services/commission-tariff.types';
import {
  computeCampaignEstimate,
  computeCampaignItem,
  suggestTargetMarginPrices,
  type CampaignTargetMarginItem,
} from '@/services/marketplace-campaign-compute.service';
import { assembleUnitEconomics } from '@/services/product-pricing.service';
import {
  NO_SHIPPING,
  tariffCommission,
  type TariffAssemblyContext,
  type TariffVariant,
} from '@/services/tariff-compute-commons';
import type { VariantCostAggregate } from '@/validators/product.validator';

// ─── Fixtures (mirrors apps/api/tests/unit/services/discount-compute.test.ts) ──

const d = (v: string | number): Decimal => new Decimal(v);

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

/** One rate at every price — isolates the matrah from any band movement. */
const openCommission: DiscountCommissionInputs = {
  bands: [{ key: 'all', lowerLimit: null, upperLimit: null, commissionPct: '15' }],
  productRate: null,
  categoryRate: null,
};

/** Nothing resolves — the chain falls through on every tier. */
const noCommission: DiscountCommissionInputs = {
  bands: null,
  productRate: null,
  categoryRate: null,
};

/**
 * Independent oracle: assembles the SAME econ the service does (cost scaled to `units` for an
 * order) at `ratePct` and runs the engine at `revenue`. Rebuilds the expected number WITHOUT
 * calling the code under test.
 */
const oracleProfit = (revenue: Decimal, ratePct: string, units = 1): Decimal => {
  const scaledCost: VariantCostAggregate = {
    ...OK_COST,
    currentCostTry: new Decimal(OK_COST.currentCostTry ?? '0').mul(units).toString(),
  };
  const probe = assembleUnitEconomics(ctx, variant, {
    costAggregate: scaledCost,
    commission: tariffCommission(d(ratePct)),
    shipping: OK_SHIPPING,
  });
  if (probe.econ === null) throw new Error('oracle econ should assemble with OK cost + shipping');
  return computeUnitProfit(probe.econ, revenue).netProfit;
};

// ─── computeCampaignItem — the three scenarios ───────────────────────────────

describe('computeCampaignItem — Trendyol karşılaması matrahı yükseltir', () => {
  // The seller enters 1.000 TL, Trendyol's promotion is NET %10 and Trendyol funds %60 of it.
  // Customer pays 900; the SELLER's settlement basis is 1000 − 100 × 0,40 = 960 (Berkin's live
  // rule, design §4.2). Two bands whose boundary sits BETWEEN the two candidate prices: a band
  // read at 900 gives %20, a band read at 960 gives %10 — so the rate alone proves which price
  // the chain used.
  const SPLIT_BANDS: StoredBand[] = [
    { key: 'high', lowerLimit: '950', upperLimit: null, commissionPct: '10' },
    { key: 'low', lowerLimit: null, upperLimit: '949.99', commissionPct: '20' },
  ];
  const splitCommission: DiscountCommissionInputs = {
    bands: SPLIT_BANDS,
    productRate: null,
    categoryRate: null,
  };
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('karşılama oranı maksimum fiyat senaryosunun matrahını yükseltir', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, splitCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(60),
    });

    // Matrah = sellerEffectivePrice(1000, NET %10, %60) = 960 — NOT the 900 the customer pays.
    expect(out.maxScenario.price.toFixed(2)).toBe('960.00');
    // …and the commission band was selected from 960 (%10), not from 900 (%20).
    expect(out.maxScenario.commissionSource).toBe('band');
    expect(out.maxScenario.commissionPct).toBe('10.0000');

    // Hand arithmetic (engine formula, GROSS convention) at matrah 960 / komisyon %10:
    //   saleVat  = 960 × 20/120                = 160
    //   cost     = 100, costVat = 100 × 20/120 = 16,666666…
    //   komisyon = 96,  komisyonVat = 96 × 20/120 = 16
    //   kargo    = 30 NET → 36 GROSS (KDV 6); PSF = 10,99 NET → 13,19 GROSS (KDV 2,198333…)
    //   stopaj   = (960 − 160) × 0,01          = 8
    //   netKDV   = 160 − 16,666666… − 16 − 8,198333… = 119,135
    //   netKâr   = 960 − 100 − 96 − 49,19 − 8 − 119,135 = 587,675 → "587.68"
    expect(out.maxScenario.netProfit).toBe('587.68');
    expect(out.maxScenario.netProfit).toBe(oracleProfit(d(960), '10').toFixed(2));
    // 587,675 / 960 × 100 = 61,2161… → "61.22"
    expect(out.maxScenario.marginPct).toBe('61.22');

    // The customer-paid price would have produced a DIFFERENT number — the failure mode this
    // whole vertical hinges on. (900 also sits in the %20 band, so the wrong reading is doubly
    // wrong; either way the value must not match.)
    expect(out.maxScenario.netProfit).not.toBe(oracleProfit(d(900), '20').toFixed(2));
  });

  it('mevcut senaryo kampanyasızdır — matrah ve bant güncel fiyattır', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, splitCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(60),
    });
    expect(out.current.price.toFixed(2)).toBe('1000.00');
    expect(out.current.commissionPct).toBe('10.0000'); // 1000 → ≥950 bandı
    expect(out.current.netProfit).toBe(oracleProfit(d(1000), '10').toFixed(2));
  });

  it('karşılama %0 iken matrah müşterinin ödediğine eşitlenir (İndirimler özel hâli)', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, splitCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(0),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('900.00');
    expect(out.maxScenario.commissionPct).toBe('20.0000'); // 900 → <950 bandı
    expect(out.maxScenario.netProfit).toBe(oracleProfit(d(900), '20').toFixed(2));
  });

  it('karşılama %100 iken indirimi tamamen Trendyol üstlenir — matrah kampanya fiyatıdır', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, splitCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(100),
    });
    expect(out.maxScenario.price.toFixed(2)).toBe('1000.00');
    expect(out.maxScenario.netProfit).toBe(out.current.netProfit);
  });
});

describe('computeCampaignItem — özel fiyat senaryosu', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('özel fiyat yoksa customScenario null döner', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(60),
    });
    expect(out.customScenario).toBeNull();
    // …while the other two scenarios are still fully priced.
    expect(out.maxScenario.netProfit).not.toBeNull();
    expect(out.current.netProfit).not.toBeNull();
  });

  it('özel fiyat maksimumun altındayken kendi senaryosunu üretir', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(800),
      selection: 'CUSTOM',
      config,
      fundingPct: d(60),
    });
    // 800 kampanya fiyatı → indirim 80 → satıcı payı 80 × 0,40 = 32 → matrah 768.
    expect(out.customScenario?.price.toFixed(2)).toBe('768.00');
    expect(out.customScenario?.netProfit).toBe(oracleProfit(d(768), '15').toFixed(2));
    // Daha düşük fiyat daha düşük kâr — maksimum senaryosunun altında kalmalı.
    expect(Number(out.customScenario?.netProfit)).toBeLessThan(Number(out.maxScenario.netProfit));
  });
});

describe('computeCampaignItem — komisyon BANDI ile MATRAH farklı fiyatlardan gelir', () => {
  const bandsAt = (boundary: string, above: string, below: string): DiscountCommissionInputs => {
    const bands: StoredBand[] = [
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

  it('X Al Y Öde kurgusunda komisyon BANDI kampanya fiyatından seçilir', () => {
    // 4 al 2 öde @1000, karşılama %50 → müşteri birimi 500, satıcının matrahı
    // 1000 − 500 × 0,50 = 750. Bant sınırı 900: kampanya fiyatı (1000) ÜSTÜNDE, matrah (750)
    // ALTINDA — yani oran tek başına hangi fiyattan okunduğunu kanıtlar.
    const out = computeCampaignItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      bandsAt('900', '19', '12'),
      {
        currentPrice: d(1000),
        maxPrice: d(1000),
        customPrice: null,
        selection: 'MAX',
        config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
        fundingPct: d(50),
      },
    );
    expect(out.maxScenario.price.toFixed(2)).toBe('750.00');
    // Raf fiyatı değişmediği (bazı adetler bedava) için bant 1000'den okunur → %19,
    // 750'den okunsaydı %12 çıkardı.
    expect(out.maxScenario.commissionPct).toBe('19.0000');
    expect(out.maxScenario.netProfit).toBe(oracleProfit(d(750), '19').toFixed(2));
  });

  it('NET kurgusunda bant HAKEDİŞ fiyatından okunur — müşterinin ödediğinden değil', () => {
    // NET %50 @1000, karşılama %60 → müşteri 500, satıcının hakedişi 1000 − 500 × 0,40 = 800.
    // Bant sınırı 700: hakediş (800) ÜSTÜNDE, müşteri fiyatı (500) ALTINDA.
    const out = computeCampaignItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      bandsAt('700', '19', '12'),
      {
        currentPrice: d(1000),
        maxPrice: d(1000),
        customPrice: null,
        selection: 'MAX',
        config: { type: 'NET', valueKind: 'PERCENT', value: d(50) },
        fundingPct: d(60),
      },
    );
    expect(out.maxScenario.price.toFixed(2)).toBe('800.00');
    expect(out.maxScenario.commissionPct).toBe('19.0000');
    expect(out.maxScenario.netProfit).toBe(oracleProfit(d(800), '19').toFixed(2));
  });

  it('NET kurgusunda karşılama yokken bant indirimli fiyata düşer (bant sıçraması korunur)', () => {
    const out = computeCampaignItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      bandsAt('600', '19', '12'),
      {
        currentPrice: d(1000),
        maxPrice: d(1000),
        customPrice: null,
        selection: 'MAX',
        config: { type: 'NET', valueKind: 'PERCENT', value: d(50) },
        fundingPct: d(0),
      },
    );
    // 1000 → indirim 500 → karşılama yok → matrah 500 → <600 bandı → %12.
    expect(out.maxScenario.price.toFixed(2)).toBe('500.00');
    expect(out.maxScenario.commissionPct).toBe('12.0000');
    expect(out.current.commissionPct).toBe('19.0000');
  });
});

describe('computeCampaignItem — sipariş (sepet) senaryosu', () => {
  const buyXPayY: DiscountConfig = { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 };

  it('sipariş senaryosunda Trendyol karşılaması ayrı alan olarak döner', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(60),
    });
    // n = buyQuantity = 4; birim ödeme 500 → sepet ödemesi 2.000; sepet tutarı 4 × 1.000 = 4.000;
    // kampanya indirimi 2.000; satıcının birim hakedişi 1000 − 500 × 0,40 = 800 → 3.200;
    // Trendyol'un karşıladığı = 3.200 − 2.000 = 1.200 (= 2.000 × %60).
    expect(out.scenario).not.toBeNull();
    expect(out.scenario?.assumedQuantity).toBe(4);
    expect(out.scenario?.basketTotal).toBe('4000.00');
    expect(out.scenario?.basketPaidTotal).toBe('2000.00');
    expect(out.scenario?.basketDiscountTotal).toBe('2000.00');
    expect(out.scenario?.trendyolFundedTotal).toBe('1200.00');
  });

  it('sipariş kârı SATICININ sepet hakedişinden hesaplanır, müşterinin ödediğinden değil', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(60),
    });
    // Hand arithmetic at order revenue 3.200 / 4 birim maliyet / %15 komisyon:
    //   saleVat = 3200 × 20/120 = 533,333…;  maliyet 400, KDV 66,666…
    //   komisyon 480, KDV 80;  kargo 36 (KDV 6) + PSF 13,19 (KDV 2,198333…) → 49,19 / 8,198333…
    //   stopaj = (3200 − 533,333…) × 0,01 = 26,666…
    //   netKDV = 533,333… − 66,666… − 80 − 8,198333… = 378,468333…
    //   netKâr = 3200 − 400 − 480 − 49,19 − 26,666… − 378,468333… = 1865,675 → "1865.68"
    expect(out.scenario?.orderNetProfit).toBe('1865.68');
    expect(out.scenario?.orderNetProfit).toBe(oracleProfit(d(3200), '15', 4).toFixed(2));
    // Müşterinin ödediği 2.000 üzerinden hesaplanmış olsaydı 1.025,68 çıkardı — 840 TL eksik.
    expect(oracleProfit(d(2000), '15', 4).toFixed(2)).toBe('1025.68');
    expect(out.scenario?.orderNetProfit).not.toBe('1025.68');
    // Marj hakediş tutarına göre: 1865,675 / 3.200 × 100 = 58,3023… → "58.30"
    expect(out.scenario?.orderMarginPct).toBe('58.30');
    // Kampanyasız taban: aynı 4 birim, güncel fiyattan (4 × 1.000).
    expect(out.scenario?.currentOrderNetProfit).toBe(oracleProfit(d(4000), '15', 4).toFixed(2));
  });

  it('karşılama %0 iken sipariş senaryosu İndirimler ile birebir aynıdır', () => {
    const campaign = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(0),
    });
    const discount = computeDiscountItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      openCommission,
      d(1000),
      buyXPayY,
    );
    expect(campaign.scenario).toEqual({ ...discount.scenario, trendyolFundedTotal: '0.00' });
  });

  it('CUSTOM seçiliyken sepet senaryosu ÖZEL fiyattan kurulur', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      selection: 'CUSTOM',
      config: buyXPayY,
      fundingPct: d(60),
    });
    // 600 kampanya fiyatı → birim ödeme 300 → sepet 4 × 600 = 2.400, ödeme 1.200,
    // satıcı hakedişi birim 600 − 300 × 0,40 = 480 → 1.920; karşılama 1.920 − 1.200 = 720.
    expect(out.scenario?.basketTotal).toBe('2400.00');
    expect(out.scenario?.basketPaidTotal).toBe('1200.00');
    expect(out.scenario?.trendyolFundedTotal).toBe('720.00');
    expect(out.scenario?.orderNetProfit).toBe(oracleProfit(d(1920), '15', 4).toFixed(2));
  });

  it('MAX seçiliyken sepet senaryosu, kayıtlı bir özel fiyat DURSA BİLE maksimumdan kurulur', () => {
    // Satıcının fiilen yaşayacağı durum: 600'ü yazıp karşılaştırmış, sonra MAX seçeneğinde
    // kalmış. Özel fiyat satırda kayıtlı durur ama sipariş dökümü seçilen seçeneğe aittir.
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(60),
    });
    // Maksimum fiyattan: sepet 4 × 1.000 = 4.000, ödeme 2.000, hakediş 3.200, karşılama 1.200.
    expect(out.scenario?.basketTotal).toBe('4000.00');
    expect(out.scenario?.basketPaidTotal).toBe('2000.00');
    expect(out.scenario?.trendyolFundedTotal).toBe('1200.00');
    expect(out.scenario?.orderNetProfit).toBe(oracleProfit(d(3200), '15', 4).toFixed(2));
    // Özel fiyat senaryosu yine de HESAPLANIR — yalnız sepet çerçevesini o belirlemez.
    expect(out.customScenario?.price.toFixed(2)).toBe('480.00');
  });

  it('NONE seçiliyken (henüz seçim yok) sepet senaryosu maksimum fiyattan kurulur', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(600),
      selection: 'NONE',
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.scenario?.basketTotal).toBe('4000.00');
    expect(out.scenario?.orderNetProfit).toBe(oracleProfit(d(3200), '15', 4).toFixed(2));
  });

  it('CUSTOM seçili ama özel fiyat yazılmamışsa sepet senaryosu maksimuma düşer (null üretmez)', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'CUSTOM',
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.customScenario).toBeNull();
    expect(out.scenario).not.toBeNull();
    expect(out.scenario?.basketTotal).toBe('4000.00');
    expect(out.scenario?.orderNetProfit).toBe(oracleProfit(d(3200), '15', 4).toFixed(2));
  });

  it('sepet miktarı n kampanya fiyatından türer (ceil(M / P))', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      // Maksimum fiyat 250 → n = ceil(1000 / 250) = 4 (güncel fiyat 1000 olsa n = 1 olurdu).
      maxPrice: d(250),
      customPrice: null,
      selection: 'MAX',
      config: {
        type: 'CONDITIONAL_BASKET',
        valueKind: 'AMOUNT',
        value: d(100),
        minBasketAmount: d(1000),
      },
      fundingPct: d(0),
    });
    expect(out.scenario?.assumedQuantity).toBe(4);
    expect(out.scenario?.basketTotal).toBe('1000.00');
    expect(out.scenario?.basketPaidTotal).toBe('900.00');
  });

  it('NET kurgusunda ve pozitif olmayan fiyatta sepet senaryosu yoktur', () => {
    const net = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config: { type: 'NET', valueKind: 'AMOUNT', value: d(50) },
      fundingPct: d(60),
    });
    expect(net.scenario).toBeNull();

    const zero = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(0),
      customPrice: null,
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(zero.scenario).toBeNull();
  });

  it('senaryonun kârı çözülemediğinde sipariş alanları null, para alanları dolu kalır', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, noCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config: buyXPayY,
      fundingPct: d(60),
    });
    expect(out.scenario?.trendyolFundedTotal).toBe('1200.00');
    expect(out.scenario?.orderNetProfit).toBeNull();
    expect(out.scenario?.orderMarginPct).toBeNull();
    expect(out.scenario?.currentOrderNetProfit).toBeNull();
  });
});

describe('computeCampaignItem — hesaplanabilirlik MEVCUT senaryodan gelir', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  it('varyant eşleşmediğinde NO_PRODUCT döner', () => {
    const out = computeCampaignItem(ctx, null, undefined, NO_SHIPPING, noCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: d(800),
      selection: 'CUSTOM',
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_PRODUCT');
    expect(out.current.netProfit).toBeNull();
    expect(out.maxScenario.netProfit).toBeNull();
    expect(out.customScenario?.netProfit).toBeNull();
  });

  it('varyant eşleşti ama komisyon zinciri boşsa NO_COMMISSION döner', () => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, noCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
  });

  it('maliyet yoksa NO_COST döner', () => {
    const out = computeCampaignItem(ctx, variant, undefined, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct: d(60),
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COST');
  });
});

// ─── computeCampaignEstimate — tek senaryonun tam dökümü ─────────────────────

describe('computeCampaignEstimate', () => {
  it('mevcut senaryo kampanyasız birim dökümü döner', () => {
    const out = computeCampaignEstimate(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      price: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: false,
    });
    expect(out.scope).toBe('unit');
    expect(out.price.toFixed(2)).toBe('1000.00');
    expect(out.breakdown?.saleGross).toBe('1000.00');
    expect(out.breakdown?.netProfit).toBe(oracleProfit(d(1000), '15').toFixed(2));
  });

  it('birim gösterimli kurguda kampanya senaryosu HAKEDİŞ fiyatının birim dökümüdür', () => {
    const out = computeCampaignEstimate(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      price: d(1000),
      config: { type: 'NET', valueKind: 'PERCENT', value: d(10) },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.scope).toBe('unit');
    expect(out.price.toFixed(2)).toBe('960.00');
    expect(out.breakdown?.saleGross).toBe('960.00');
    expect(out.commissionPct).toBe('15.0000');
  });

  it('sipariş gösterimli kurguda kampanya senaryosu SİPARİŞ dökümüdür (satıcı hakedişi)', () => {
    const out = computeCampaignEstimate(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      price: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.scope).toBe('order');
    // Sipariş geliri = satıcının sepet hakedişi (4 × 800), müşterinin ödediği 2.000 DEĞİL.
    expect(out.price.toFixed(2)).toBe('3200.00');
    expect(out.breakdown?.saleGross).toBe('3200.00');
    expect(out.breakdown?.netProfit).toBe('1865.68');
    // Kargo ve PSF sipariş başına BİR kez sayılır (koli başına ücret).
    expect(out.breakdown?.shippingGross).toBe('36.00');
    expect(out.breakdown?.platformServiceGross).toBe('13.19');
    // Maliyet ise 4 birime ölçeklenir.
    expect(out.breakdown?.costGross).toBe('400.00');
  });

  it('hesaplanamayan kalemde döküm null, gerekçe dolu döner', () => {
    const out = computeCampaignEstimate(ctx, variant, OK_COST, OK_SHIPPING, noCommission, {
      price: d(1000),
      config: { type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 2 },
      fundingPct: d(60),
      applyCampaign: true,
    });
    expect(out.calculable).toBe(false);
    expect(out.reason).toBe('NO_COMMISSION');
    expect(out.breakdown).toBeNull();
    expect(out.scope).toBe('order');
  });
});

// ─── suggestTargetMarginPrices ───────────────────────────────────────────────

describe('suggestTargetMarginPrices', () => {
  const config: DiscountConfig = { type: 'NET', valueKind: 'PERCENT', value: d(10) };

  const item = (over: Partial<CampaignTargetMarginItem> = {}): CampaignTargetMarginItem => ({
    itemId: 'i1',
    variant,
    cost: OK_COST,
    shipping: OK_SHIPPING,
    commission: openCommission,
    maxPrice: d(1000),
    ...over,
  });

  /** The unit margin the item would actually earn if the seller entered `price`. */
  const marginAt = (price: Decimal, fundingPct: Decimal): number => {
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: price,
      selection: 'CUSTOM',
      config,
      fundingPct,
    });
    return Number(out.customScenario?.marginPct);
  };

  it('hedefe ulaşan EN KÜÇÜK kampanya fiyatını önerir', () => {
    const [suggestion] = suggestTargetMarginPrices(ctx, [item()], {
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
    });
    expect(suggestion?.reason).toBeNull();
    expect(suggestion?.price).not.toBeNull();

    const price = d(suggestion?.price ?? '0');
    expect(price.lte(d(1000))).toBe(true);
    // Önerilen fiyat hedefi tutturur…
    expect(marginAt(price, d(0))).toBeGreaterThanOrEqual(30);
    // …ve 1 TL altı tutturmaz (gerçekten en küçük fiyat).
    expect(marginAt(price.sub(1), d(0))).toBeLessThan(30);
  });

  it('karşılama oranı yükseldikçe aynı hedef daha DÜŞÜK kampanya fiyatıyla tutar', () => {
    const [zeroFunding] = suggestTargetMarginPrices(ctx, [item()], {
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
    });
    const [funded] = suggestTargetMarginPrices(ctx, [item()], {
      config,
      fundingPct: d(60),
      targetMarginPct: d(30),
    });
    expect(funded?.price).not.toBeNull();
    expect(Number(funded?.price)).toBeLessThan(Number(zeroFunding?.price));
    expect(marginAt(d(funded?.price ?? '0'), d(60))).toBeGreaterThanOrEqual(30);
  });

  it('hiçbir fiyatın tutturamadığı marjda UNREACHABLE döner', () => {
    const [suggestion] = suggestTargetMarginPrices(ctx, [item()], {
      config,
      fundingPct: d(0),
      targetMarginPct: d(95),
    });
    expect(suggestion).toEqual({ itemId: 'i1', price: null, reason: 'UNREACHABLE' });
  });

  it('hedef maksimum fiyatın üstünde bir hakediş gerektiriyorsa UNREACHABLE döner', () => {
    // 200 TL tavanda %10 indirimle hakediş en fazla 180; %50 marj için gereken hakediş çok daha
    // yüksek — çözüm var ama tavanın üstünde kalıyor.
    const [suggestion] = suggestTargetMarginPrices(ctx, [item({ maxPrice: d(200) })], {
      config,
      fundingPct: d(0),
      targetMarginPct: d(50),
    });
    expect(suggestion).toEqual({ itemId: 'i1', price: null, reason: 'UNREACHABLE' });
  });

  it('ürün, maliyet ya da komisyon eksikse NOT_CALCULABLE döner', () => {
    const out = suggestTargetMarginPrices(
      ctx,
      [
        item({ itemId: 'no-product', variant: null }),
        item({ itemId: 'no-cost', cost: undefined }),
        item({ itemId: 'no-commission', commission: noCommission }),
        item({ itemId: 'no-shipping', shipping: NO_SHIPPING }),
      ],
      { config, fundingPct: d(0), targetMarginPct: d(30) },
    );
    expect(out).toEqual([
      { itemId: 'no-product', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'no-cost', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'no-commission', price: null, reason: 'NOT_CALCULABLE' },
      { itemId: 'no-shipping', price: null, reason: 'NOT_CALCULABLE' },
    ]);
  });

  it('her kalem için sırayla tek sonuç döner ve girdileri değiştirmez', () => {
    const items = [item({ itemId: 'a' }), item({ itemId: 'b', maxPrice: d(500) })];
    const snapshot = JSON.stringify(items.map((i) => i.maxPrice.toFixed(2)));
    const out = suggestTargetMarginPrices(ctx, items, {
      config,
      fundingPct: d(0),
      targetMarginPct: d(30),
    });
    expect(out.map((s) => s.itemId)).toEqual(['a', 'b']);
    expect(JSON.stringify(items.map((i) => i.maxPrice.toFixed(2)))).toBe(snapshot);
  });
});

// ─── Paylaşık matematik köprüsü ──────────────────────────────────────────────

describe('kampanya senaryosu paylaşık matematikten türer', () => {
  it('matrah sellerEffectivePrice ile birebir aynıdır (formül ikinci kez yazılmaz)', () => {
    const config: DiscountConfig = {
      type: 'NTH_PRODUCT',
      valueKind: 'FIXED_PRICE',
      value: d(10),
      nthIndex: 4,
    };
    const maxPrice = d('374.99');
    const fundingPct = d('37.5');
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, openCommission, {
      currentPrice: d(400),
      maxPrice,
      customPrice: null,
      selection: 'MAX',
      config,
      fundingPct,
    });
    expect(out.maxScenario.price.toString()).toBe(
      sellerEffectivePrice(maxPrice, config, fundingPct).toString(),
    );
    // Müşterinin ödediği ile karıştırılmadığının kanıtı: ikisi farklı olmalı.
    expect(out.maxScenario.price.toString()).not.toBe(
      effectiveUnitPrice(maxPrice, config).toString(),
    );
  });

  it('bant çözümü 2 haneye yuvarlanmış fiyattan yapılır (0,01 boşluğuna düşmez)', () => {
    // NET %20 @374,99 → müşteri 299,992; karşılama 0 → hakediş de 299,992. Bant sınırları
    // 2 hanelidir: 299,99'a yuvarlanmazsa 300 ile 299,99 arasındaki boşluğa düşer.
    const BANDS: StoredBand[] = [
      { key: 'band1', lowerLimit: '300', upperLimit: null, commissionPct: '10' },
      { key: 'band2', lowerLimit: '150', upperLimit: '299.99', commissionPct: '12' },
    ];
    const out = computeCampaignItem(
      ctx,
      variant,
      OK_COST,
      OK_SHIPPING,
      { bands: BANDS, productRate: null, categoryRate: null },
      {
        currentPrice: d('374.99'),
        maxPrice: d('374.99'),
        customPrice: null,
        selection: 'MAX',
        config: { type: 'NET', valueKind: 'PERCENT', value: d(20) },
        fundingPct: d(0),
      },
    );
    expect(out.current.commissionPct).toBe('10.0000');
    expect(out.maxScenario.commissionSource).toBe('band');
    expect(out.maxScenario.commissionPct).toBe('12.0000');
  });

  it('komisyon zincirinde bant yoksa ürün oranına, o da yoksa kategoriye düşer', () => {
    const chain: DiscountCommissionInputs = {
      bands: null,
      productRate: d('21.5'),
      categoryRate: d(19),
    };
    const out = computeCampaignItem(ctx, variant, OK_COST, OK_SHIPPING, chain, {
      currentPrice: d(1000),
      maxPrice: d(1000),
      customPrice: null,
      selection: 'MAX',
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
