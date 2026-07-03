import { describe, expect, it } from 'vitest';

import { resolvePlusTariffLayout } from '@/services/plus-commission-tariff-layout';

// The real Trendyol "Plus Komisyon" header row (22 columns, single 7-day period).
const PLUS_HEADER: readonly string[] = [
  'Ürün İsmi', // 0
  'Ürün Id', // 1
  'Barkod', // 2
  'Satıcı Stok Kodu', // 3
  'Beden', // 4
  'Model Kodu', // 5
  'Kategori', // 6
  'Marka', // 7
  'Stok', // 8
  'Güncel TSF', // 9
  'Komisyona Esas Fiyat', // 10
  'Güncel Komisyon', // 11
  'Plus Fiyat Üst Limiti', // 12
  'Tarih Aralığı (7 Gün)', // 13
  'Plus Komisyon Teklifi', // 14
  'Plus Komisyona Esas Fiyatı', // 15
  'Plus Fiyat Seçimi', // 16
  'Tarife Seçimi', // 17
  'Hesaplanan Komisyon (7 Gün)', // 18
  'İptal', // 19
  'External Id', // 20
  'Tarife Grubu', // 21
];

describe('resolvePlusTariffLayout', () => {
  it('resolves every column of the real Plus header by name', () => {
    const layout = resolvePlusTariffLayout(PLUS_HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.barcode).toBe(2);
    expect(layout?.modelCode).toBe(5);
    expect(layout?.stock).toBe(8);
    expect(layout?.currentPrice).toBe(9);
    expect(layout?.commissionBasePrice).toBe(10);
    expect(layout?.currentCommission).toBe(11);
    expect(layout?.plusPriceUpperLimit).toBe(12);
    expect(layout?.periodLabel).toBe(13);
    expect(layout?.dayCount).toBe(7);
    expect(layout?.plusCommissionPct).toBe(14);
    expect(layout?.plusCommissionBasePrice).toBe(15);
    expect(layout?.plusPriceSelection).toBe(16);
    expect(layout?.tariffSelection).toBe(17);
    expect(layout?.computedCommission).toBe(18);
    expect(layout?.externalId).toBe(20);
    expect(layout?.tariffGroup).toBe(21);
  });

  it('tolerates the lowercase "aralığı" spelling in the period header', () => {
    const header = PLUS_HEADER.map((h) =>
      h === 'Tarih Aralığı (7 Gün)' ? 'Tarih aralığı (7 Gün)' : h,
    );
    expect(resolvePlusTariffLayout(header)?.dayCount).toBe(7);
  });

  it('returns null when the period header is missing', () => {
    const header = PLUS_HEADER.filter((h) => !h.startsWith('Tarih'));
    expect(resolvePlusTariffLayout(header)).toBeNull();
  });

  it('returns null when a required column (Barkod) is missing', () => {
    const header = PLUS_HEADER.filter((h) => h !== 'Barkod');
    expect(resolvePlusTariffLayout(header)).toBeNull();
  });

  it('returns null on a non-Plus header row', () => {
    expect(resolvePlusTariffLayout(['not', 'a', 'plus', 'header'])).toBeNull();
  });
});
