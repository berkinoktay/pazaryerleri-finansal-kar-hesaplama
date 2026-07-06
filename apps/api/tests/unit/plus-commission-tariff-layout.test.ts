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

// The real Trendyol two-period ("3ve4 günlük") header: each period is a
// "Tarih Aralığı (N Gün)" label immediately followed by its own
// "Plus Komisyon Teklifi" offer column. The trailing "N Gün Tarih Aralığı" /
// "External Id (N Gün)" columns are decoys that must NOT parse as periods.
const PLUS_HEADER_MULTI: readonly string[] = [
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
  'Tarih Aralığı (3 Gün)', // 13  ← period 1 label
  'Plus Komisyon Teklifi', // 14  ← period 1 offer
  'Tarih Aralığı (4 Gün)', // 15  ← period 2 label
  'Plus Komisyon Teklifi', // 16  ← period 2 offer
  'Plus Komisyona Esas Fiyatı', // 17
  'Plus Fiyat Seçimi', // 18
  'Tarife Seçimi', // 19
  'External Id', // 20
  'Hesaplanan Komisyon (3 Gün)', // 21
  'Hesaplanan Komisyon (4 Gün)', // 22
  'İptal', // 23
  'Tarife Grubu', // 24
  '3 Gün Tarih Aralığı', // 25  ← decoy, not a period header
  '4 Gün Tarih Aralığı', // 26  ← decoy
  '7 Gün Tarih Aralığı', // 27  ← decoy
  'External Id (3 Gün)', // 28
  'External Id (4 Gün)', // 29
  'External Id (7 Gün)', // 30
];

describe('resolvePlusTariffLayout', () => {
  it('resolves every column of the real single-period Plus header by name', () => {
    const layout = resolvePlusTariffLayout(PLUS_HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.barcode).toBe(2);
    expect(layout?.modelCode).toBe(5);
    expect(layout?.stock).toBe(8);
    expect(layout?.currentPrice).toBe(9);
    expect(layout?.commissionBasePrice).toBe(10);
    expect(layout?.currentCommission).toBe(11);
    expect(layout?.plusPriceUpperLimit).toBe(12);
    expect(layout?.plusCommissionBasePrice).toBe(15);
    expect(layout?.plusPriceSelection).toBe(16);
    expect(layout?.tariffSelection).toBe(17);
    expect(layout?.externalId).toBe(20);
    expect(layout?.tariffGroup).toBe(21);

    // One 7-day period; its offer sits at labelCol + 1 and the computed-commission
    // write-back target is located by "Hesaplanan Komisyon (7 Gün)".
    expect(layout?.periods).toHaveLength(1);
    expect(layout?.periods[0]?.dayCount).toBe(7);
    expect(layout?.periods[0]?.labelCol).toBe(13);
    expect(layout?.periods[0]?.offerCol).toBe(14);
    expect(layout?.periods[0]?.computedCommissionCol).toBe(18);
  });

  it('resolves both periods of a two-period Plus header, offer + computed per period', () => {
    const layout = resolvePlusTariffLayout(PLUS_HEADER_MULTI);
    expect(layout).not.toBeNull();

    // Two periods, in sheet order (3 gün then 4 gün); the trailing decoys are ignored.
    expect(layout?.periods.map((p) => p.dayCount)).toEqual([3, 4]);
    expect(layout?.periods[0]?.labelCol).toBe(13);
    expect(layout?.periods[0]?.offerCol).toBe(14);
    expect(layout?.periods[0]?.computedCommissionCol).toBe(21);
    expect(layout?.periods[1]?.labelCol).toBe(15);
    expect(layout?.periods[1]?.offerCol).toBe(16);
    expect(layout?.periods[1]?.computedCommissionCol).toBe(22);

    // Singular columns still resolve by name past the second period block.
    expect(layout?.plusCommissionBasePrice).toBe(17);
    expect(layout?.plusPriceSelection).toBe(18);
    expect(layout?.tariffSelection).toBe(19);
    expect(layout?.externalId).toBe(20);
    expect(layout?.tariffGroup).toBe(24);
  });

  it('tolerates a missing computed-commission column for a period (-1, not required)', () => {
    const header = PLUS_HEADER.filter((h) => !h.startsWith('Hesaplanan Komisyon'));
    const layout = resolvePlusTariffLayout(header);
    expect(layout).not.toBeNull();
    expect(layout?.periods[0]?.computedCommissionCol).toBe(-1);
  });

  it('tolerates the lowercase "aralığı" spelling in the period header', () => {
    const header = PLUS_HEADER.map((h) =>
      h === 'Tarih Aralığı (7 Gün)' ? 'Tarih aralığı (7 Gün)' : h,
    );
    expect(resolvePlusTariffLayout(header)?.periods[0]?.dayCount).toBe(7);
  });

  it('returns null when the column after a period label is not the offer column', () => {
    const header = PLUS_HEADER.map((h) =>
      h === 'Plus Komisyon Teklifi' ? 'Bir Başka Kolon' : h,
    );
    expect(resolvePlusTariffLayout(header)).toBeNull();
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
