import { describe, expect, it } from 'vitest';

import { resolveMarketplaceCampaignLayout } from '@/services/marketplace-campaign-layout';

const HEADER = [
  'Barkod',
  'Ürün Adı',
  'Ürün Kodu',
  'Kategori',
  'Marka',
  'Renk',
  'Beden',
  'Stok Kodu',
  'Mevcut Stok',
  'Mevcut Satış Fiyatı',
  'Maksimum Girebileceğin Fiyat',
  'Kampanyalı Satış Fiyatı',
  'Ürün Komisyon Tarifesi',
  'ListingId',
];

describe('resolveMarketplaceCampaignLayout', () => {
  it('gerçek Trendyol başlık satırını çözer', () => {
    const layout = resolveMarketplaceCampaignLayout(HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.barcode).toBe(0);
    expect(layout?.currentPrice).toBe(9);
    expect(layout?.maxPrice).toBe(10);
    expect(layout?.campaignPrice).toBe(11);
    expect(layout?.commissionTariffFlag).toBe(12);
    expect(layout?.externalId).toBe(13);
  });

  it('kolon sırası değişse de ada göre çözer', () => {
    const shuffled = [...HEADER].reverse();
    const layout = resolveMarketplaceCampaignLayout(shuffled);
    expect(layout).not.toBeNull();
    expect(shuffled[layout?.barcode ?? -1]).toBe('Barkod');
    expect(shuffled[layout?.campaignPrice ?? -1]).toBe('Kampanyalı Satış Fiyatı');
  });

  it.each(HEADER)('zorunlu başlık "%s" eksikse null döner', (missing) => {
    const withoutOne = HEADER.filter((h) => h !== missing);
    expect(resolveMarketplaceCampaignLayout(withoutOne)).toBeNull();
  });

  it('İndirimler dosyasının başlıklarını kabul etmez', () => {
    const discountHeader = [
      'Trendyol Ürün ID',
      'Ürün Bilgisi',
      'Marka',
      'Renk',
      'Barkod',
      'Model Kodu',
      'Güncel Satış Fiyatı',
      'Buybox',
      'Kampayaya Dahil Edilsin Mi?',
    ];
    expect(resolveMarketplaceCampaignLayout(discountHeader)).toBeNull();
  });
});
