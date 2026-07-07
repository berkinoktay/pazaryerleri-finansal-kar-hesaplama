import { describe, expect, it } from 'vitest';

import { resolveFlashProductLayout } from '@/services/flash-product-layout';

// The real Trendyol "Flaş Ürünler" header row (20 Title-Case columns; a row carries
// its own 24h + 3h offer windows with per-row start/end dates).
const FLASH_HEADER: readonly string[] = [
  'Model Kodu', // 0
  'Barkod', // 1
  'Ürün Adı', // 2
  'Kategori', // 3
  'Marka', // 4
  'Stok', // 5
  'Mevcut Fiyat', // 6
  'Müşterinin Gördüğü Fiyat', // 7
  'Mevcut Komisyon', // 8
  'Güncellenecek Fiyat', // 9
  '24 Saat Fiyat', // 10
  '3 Saat Fiyat', // 11
  'Senin Belirlediğin Flaş Fiyatı', // 12
  '24 Saat Flaş Başlangıç Tarihi', // 13
  '24 Saat Flaş Bitiş Tarihi', // 14
  '3 Saat Flaş Başlangıç Tarihi', // 15
  '3 Saat Flaş Bitiş Tarihi', // 16
  'Ürün Komisyon Tarife Seçeneği', // 17
  'Kampanyalı Ürün', // 18
  'Ürün Id', // 19
];

describe('resolveFlashProductLayout', () => {
  it('resolves every column of the real Flash header by name', () => {
    const layout = resolveFlashProductLayout(FLASH_HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.modelCode).toBe(0);
    expect(layout?.barcode).toBe(1);
    expect(layout?.productTitle).toBe(2);
    expect(layout?.category).toBe(3);
    expect(layout?.brand).toBe(4);
    expect(layout?.stock).toBe(5);
    expect(layout?.currentPrice).toBe(6);
    expect(layout?.customerPrice).toBe(7);
    expect(layout?.currentCommission).toBe(8);
    expect(layout?.offer24Price).toBe(10);
    expect(layout?.offer3Price).toBe(11);
    expect(layout?.offer24Start).toBe(13);
    expect(layout?.offer24End).toBe(14);
    expect(layout?.offer3Start).toBe(15);
    expect(layout?.offer3End).toBe(16);
    expect(layout?.commissionTariffFlag).toBe(17);
    expect(layout?.campaignedProduct).toBe(18);
    expect(layout?.externalId).toBe(19);
  });

  it('resolves the write-back target columns (Güncellenecek Fiyat, Senin Belirlediğin Flaş Fiyatı)', () => {
    const layout = resolveFlashProductLayout(FLASH_HEADER);
    // Not required at import, but export patches these.
    expect(layout?.updatedPrice).toBe(9);
    expect(layout?.customFlashPrice).toBe(12);
  });

  it('returns null when a required column (Barkod) is missing', () => {
    const header = FLASH_HEADER.filter((h) => h !== 'Barkod');
    expect(resolveFlashProductLayout(header)).toBeNull();
  });

  it('returns null when an offer price column (3 Saat Fiyat) is missing', () => {
    const header = FLASH_HEADER.filter((h) => h !== '3 Saat Fiyat');
    expect(resolveFlashProductLayout(header)).toBeNull();
  });

  it('returns null on a non-Flash header row', () => {
    expect(resolveFlashProductLayout(['not', 'a', 'flash', 'header'])).toBeNull();
  });
});
