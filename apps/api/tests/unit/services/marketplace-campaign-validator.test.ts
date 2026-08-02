import { describe, expect, it } from 'vitest';

import {
  MarketplaceCampaignConfigFieldsSchema,
  campaignConfigFromFields,
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
