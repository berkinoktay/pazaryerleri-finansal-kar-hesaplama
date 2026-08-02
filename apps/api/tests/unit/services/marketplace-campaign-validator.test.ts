import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { Prisma } from '@pazarsync/db';

import {
  EstimateCampaignItemBodySchema,
  EstimateCampaignItemResultSchema,
  ImportMarketplaceCampaignFormSchema,
  MarketplaceCampaignConfigFieldsSchema,
  MarketplaceCampaignDetailItemSchema,
  MarketplaceCampaignDetailSchema,
  MarketplaceCampaignListItemSchema,
  TargetMarginBodySchema,
  UpdateCampaignSelectionsBodySchema,
  UpdateMarketplaceCampaignBodySchema,
  campaignConfigFromFields,
  campaignConfigFromListRow,
  isCampaignDiscountType,
  type MarketplaceCampaignConfigRow,
} from '@/validators/marketplace-campaign.validator';

const WINDOW = {
  startsAt: '2026-08-04T05:00:00.000Z',
  endsAt: '2026-08-11T04:59:00.000Z',
} as const;

describe('MarketplaceCampaignConfigFieldsSchema', () => {
  it('geçerli net yüzde kurgusunu kabul eder', () => {
    const parsed = MarketplaceCampaignConfigFieldsSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '60',
      ...WINDOW,
    });
    expect(parsed.success).toBe(true);
  });

  it('CODE kurgusunu REDDEDER — kupon Kampanyalar sayfasında ayrı tür değildir', () => {
    const parsed = MarketplaceCampaignConfigFieldsSchema.safeParse({
      discountType: 'CODE',
      valueKind: 'AMOUNT',
      value: '100',
      minBasketAmount: '750',
      trendyolFundingPct: '0',
      ...WINDOW,
    });
    expect(parsed.success).toBe(false);
  });

  it('karşılama oranı 100 üstündeyse reddeder', () => {
    const parsed = MarketplaceCampaignConfigFieldsSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '120',
      ...WINDOW,
    });
    expect(parsed.success).toBe(false);
  });

  it('karşılama oranı verilmezse varsayılan 0 olur', () => {
    const parsed = MarketplaceCampaignConfigFieldsSchema.parse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      ...WINDOW,
    });
    expect(parsed.trendyolFundingPct).toBe('0');
  });

  it('tarih zorunludur', () => {
    const parsed = MarketplaceCampaignConfigFieldsSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('campaignConfigFromFields', () => {
  it('X Al Y Öde alanlarını compute config yapısına indirir', () => {
    const config = campaignConfigFromFields({
      discountType: 'BUY_X_PAY_Y',
      buyQuantity: '3',
      payQuantity: '2',
      trendyolFundingPct: '0',
      ...WINDOW,
    });
    expect(config).toEqual({ type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 });
  });
});

// ─── Finding 2 (fix round 2): campaignConfigFromListRow round-trip ────────────
//
// The brief explicitly calls this bridge out as the thing that must NOT become a duplicate
// switch. These tests prove it actually delegates to campaignConfigFromFields end-to-end,
// including the string<->number/Decimal conversions a shortcut implementation could get
// wrong for one type without anyone noticing.

describe('campaignConfigFromListRow', () => {
  it('NTH_PRODUCT satırını doğru DiscountConfig’e çevirir (Decimal→string ve Int→string dönüşümleri dahil)', () => {
    const row: MarketplaceCampaignConfigRow = {
      discountType: 'NTH_PRODUCT',
      valueKind: 'FIXED_PRICE',
      value: new Prisma.Decimal('49.90'),
      minBasketAmount: null,
      minQuantity: null,
      buyQuantity: null,
      payQuantity: null,
      nthIndex: 3,
      trendyolFundingPct: new Prisma.Decimal('25'),
    };

    const config = campaignConfigFromListRow(row);

    expect(config).toEqual({
      type: 'NTH_PRODUCT',
      valueKind: 'FIXED_PRICE',
      value: new Decimal('49.90'),
      nthIndex: 3,
    });
  });

  it('BUY_X_PAY_Y satırını doğru DiscountConfig’e çevirir (value/minBasketAmount alanları null olsa da)', () => {
    const row: MarketplaceCampaignConfigRow = {
      discountType: 'BUY_X_PAY_Y',
      valueKind: null,
      value: null,
      minBasketAmount: null,
      minQuantity: null,
      buyQuantity: 4,
      payQuantity: 3,
      nthIndex: null,
      trendyolFundingPct: new Prisma.Decimal('0'),
    };

    const config = campaignConfigFromListRow(row);

    expect(config).toEqual({ type: 'BUY_X_PAY_Y', buyQuantity: 4, payQuantity: 3 });
  });
});

// ─── Finding 4 (fix round 2): isCampaignDiscountType guard + CODE rejection ───

describe('isCampaignDiscountType', () => {
  it('kampanya türlerinin beşi için de true döner', () => {
    const types = [
      'NET',
      'CONDITIONAL_BASKET',
      'CONDITIONAL_QUANTITY',
      'BUY_X_PAY_Y',
      'NTH_PRODUCT',
    ] as const;
    for (const type of types) {
      expect(isCampaignDiscountType(type)).toBe(true);
    }
  });

  it('CODE için false döner', () => {
    expect(isCampaignDiscountType('CODE')).toBe(false);
  });
});

describe('campaignConfigFromListRow — CODE guard', () => {
  it('discountType=CODE taşıyan satırda açık bir hata fırlatır (sessizce yanlış config üretmez)', () => {
    const row: MarketplaceCampaignConfigRow = {
      discountType: 'CODE',
      valueKind: 'AMOUNT',
      value: new Prisma.Decimal('100'),
      minBasketAmount: new Prisma.Decimal('750'),
      minQuantity: null,
      buyQuantity: null,
      payQuantity: null,
      nthIndex: null,
      trendyolFundingPct: new Prisma.Decimal('0'),
    };

    expect(() => campaignConfigFromListRow(row)).toThrow(/CODE/);
  });
});

// ─── Finding 3 (fix round 2): refineDiscountConfig + funding cap survive .extend() ──
//
// ImportMarketplaceCampaignFormSchema and UpdateMarketplaceCampaignBodySchema are both
// built as `MarketplaceCampaignConfigFieldsSchema.extend({...})`. In this Zod version that
// preserves the base schema's `.superRefine()` (unlike the İndirimler sibling, which
// re-applies its refine function at each usage site) — these tests pin that behaviour so a
// future refactor of the base schema's refinement can't silently stop propagating.

describe('ImportMarketplaceCampaignFormSchema — inherited superRefine', () => {
  const file = new File(['x'], 'kampanya.xlsx');

  it('dosya eksikse reddeder', () => {
    const parsed = ImportMarketplaceCampaignFormSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      ...WINDOW,
    });
    expect(parsed.success).toBe(false);
  });

  it('yalnız bir tür-başına kuralın reddedeceği bir gövdeyi reddeder (refineDiscountConfig .extend() sonrası da çalışıyor)', () => {
    // payQuantity >= buyQuantity İndirimler'in refineDiscountConfig'inde YALNIZ bu kural
    // tarafından reddedilir — üst seviye "alan eksik" kontrolleriyle örtüşmez.
    const parsed = ImportMarketplaceCampaignFormSchema.safeParse({
      discountType: 'BUY_X_PAY_Y',
      buyQuantity: '3',
      payQuantity: '3',
      file,
      ...WINDOW,
    });
    expect(parsed.success).toBe(false);
  });

  it('karşılama oranı 100 üstündeyse .extend() sonrası da reddeder', () => {
    const parsed = ImportMarketplaceCampaignFormSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '150',
      file,
      ...WINDOW,
    });
    expect(parsed.success).toBe(false);
  });

  it('geçerli bir gövdeyi kabul eder', () => {
    const parsed = ImportMarketplaceCampaignFormSchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      trendyolFundingPct: '50',
      file,
      name: 'Test kampanya',
      ...WINDOW,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('UpdateMarketplaceCampaignBodySchema — inherited superRefine', () => {
  it('tarih eksikse .extend() sonrası da reddeder', () => {
    const parsed = UpdateMarketplaceCampaignBodySchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      name: 'Yeni ad',
    });
    expect(parsed.success).toBe(false);
  });

  it('name olmadan da geçerli bir gövdeyi kabul eder', () => {
    const parsed = UpdateMarketplaceCampaignBodySchema.safeParse({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      ...WINDOW,
    });
    expect(parsed.success).toBe(true);
  });
});

// ─── Finding 1 (fix round 2): Adım 5 response/request schema surface ──────────
//
// Targets things that would actually break downstream (Task 8's routes, Task 12's
// generated client, the frontend): required-vs-optional, nullable-vs-absent, the
// regex-guarded string fields, enum boundaries, and the selections array cap. Deliberately
// NOT padded with cases that only restate the inferred TS type.

describe('MarketplaceCampaignListItemSchema', () => {
  const base = {
    id: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
    name: 'Kampanya',
    discountType: 'NET' as const,
    valueKind: 'PERCENT' as const,
    value: '10',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    startsAt: WINDOW.startsAt,
    endsAt: WINDOW.endsAt,
    itemCount: 5,
    selectedCount: 2,
    exported: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  it('trendyolFundingPct eksikse reddeder — liste satırının §7 rozeti bu alana bağlı (fix round 1 regresyon koruması)', () => {
    const parsed = MarketplaceCampaignListItemSchema.safeParse(base);
    expect(parsed.success).toBe(false);
  });

  it('geçerli bir satırı kabul eder', () => {
    const parsed = MarketplaceCampaignListItemSchema.safeParse({
      ...base,
      trendyolFundingPct: '60',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('MarketplaceCampaignDetailItemSchema', () => {
  const validItem = {
    id: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
    barcode: '8680000000001',
    productCode: 'PC-1',
    externalId: 'EXT-1',
    productTitle: 'Test Ürün',
    brand: 'Marka',
    color: 'Siyah',
    size: '42',
    category: 'Ayakkabı',
    stock: 10,
    imageUrl: 'https://example.com/x.jpg',
    currentPrice: '100.00',
    maxPrice: '120.00',
    hasCommissionTariff: true,
    selection: 'MAX' as const,
    customPrice: null,
    calculable: true,
    reason: null,
    current: {
      price: '100.00',
      commissionPct: '13.10',
      commissionSource: 'band' as const,
      netProfit: '20.00',
      marginPct: '20.00',
    },
    maxScenario: {
      price: '120.00',
      commissionPct: '13.10',
      commissionSource: 'band' as const,
      netProfit: '30.00',
      marginPct: '25.00',
    },
    customScenario: null,
    commissionBands: null,
    scenario: null,
  };

  it('geçerli bir kalemi kabul eder', () => {
    expect(MarketplaceCampaignDetailItemSchema.safeParse(validItem).success).toBe(true);
  });

  it('customScenario anahtarı tamamen eksikse reddeder — nullable, optional DEĞİLDİR', () => {
    const { customScenario: _customScenario, ...withoutKey } = validItem;
    expect(MarketplaceCampaignDetailItemSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('selection geçersiz bir değer taşıyorsa reddeder', () => {
    const parsed = MarketplaceCampaignDetailItemSchema.safeParse({
      ...validItem,
      selection: 'INVALID',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('MarketplaceCampaignDetailSchema', () => {
  it('trendyolFundingPct dahil eksiksiz bir gövdeyi kabul eder (paylaşılan shape doğru devrediyor)', () => {
    const parsed = MarketplaceCampaignDetailSchema.safeParse({
      id: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
      name: 'Kampanya',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
      minBasketAmount: null,
      minQuantity: null,
      buyQuantity: null,
      payQuantity: null,
      nthIndex: null,
      trendyolFundingPct: '0',
      startsAt: WINDOW.startsAt,
      endsAt: WINDOW.endsAt,
      exported: false,
      commissionTariffName: null,
      commissionPeriodLabel: null,
      commissionTariffOutdated: false,
      scenarioPresentation: 'UNIT',
      items: [],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('UpdateCampaignSelectionsBodySchema', () => {
  it('mode=set iken boş selections reddeder', () => {
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({ mode: 'set', selections: [] });
    expect(parsed.success).toBe(false);
  });

  it('mode=all iken boş selections kabul eder (bulk işaretleme tek istekte)', () => {
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({ mode: 'all' });
    expect(parsed.success).toBe(true);
  });

  it('bir satırın selection alanı geçersizse reddeder', () => {
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({
      mode: 'set',
      selections: [
        {
          itemId: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
          selection: 'INVALID',
          customPrice: null,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('bir satırın customPrice’ı bozuk formattaysa reddeder', () => {
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({
      mode: 'set',
      selections: [
        {
          itemId: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
          selection: 'CUSTOM',
          customPrice: 'abc',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('customPrice null olabilir', () => {
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({
      mode: 'set',
      selections: [
        { itemId: 'a1b2c3d4-e5f6-4890-a234-ef1234567890', selection: 'MAX', customPrice: null },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('selections 5000 sınırını aşarsa reddeder', () => {
    const selections = Array.from({ length: 5001 }, (_, i) => ({
      itemId: `a1b2c3d4-e5f6-4890-a234-${String(i).padStart(12, '0')}`,
      selection: 'NONE' as const,
      customPrice: null,
    }));
    const parsed = UpdateCampaignSelectionsBodySchema.safeParse({ mode: 'set', selections });
    expect(parsed.success).toBe(false);
  });
});

describe('EstimateCampaignItemBodySchema / EstimateCampaignItemResultSchema', () => {
  it('İndirimler’in eski "discounted" senaryo değerini reddeder — Kampanyalar current/max/custom kullanır', () => {
    const parsed = EstimateCampaignItemBodySchema.safeParse({ scenario: 'discounted' });
    expect(parsed.success).toBe(false);
  });

  it('customPrice 2’den fazla ondalık taşırsa reddeder', () => {
    const parsed = EstimateCampaignItemBodySchema.safeParse({
      scenario: 'custom',
      customPrice: '12.345',
    });
    expect(parsed.success).toBe(false);
  });

  it('geçerli bir max-senaryo sonucunu kabul eder', () => {
    const parsed = EstimateCampaignItemResultSchema.safeParse({
      itemId: 'a1b2c3d4-e5f6-4890-a234-ef1234567890',
      scenario: 'max',
      price: '120.00',
      commissionPct: '13.10',
      commissionSource: 'band',
      calculable: true,
      reason: null,
      breakdown: null,
      breakdownScope: 'unit',
      commissionTariffName: null,
      commissionPeriodLabel: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('TargetMarginBodySchema', () => {
  it('negatif hedef marjı reddeder', () => {
    const parsed = TargetMarginBodySchema.safeParse({ targetMarginPct: '-5' });
    expect(parsed.success).toBe(false);
  });

  it('geçerli bir hedef marjı kabul eder', () => {
    const parsed = TargetMarginBodySchema.safeParse({ targetMarginPct: '20' });
    expect(parsed.success).toBe(true);
  });
});
