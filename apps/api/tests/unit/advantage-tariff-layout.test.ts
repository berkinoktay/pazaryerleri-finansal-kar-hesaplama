import { describe, expect, it } from 'vitest';

import { resolveAdvantageTariffLayout } from '@/services/advantage-tariff-layout';

// The real Trendyol "Avantajlı Ürün Etiketleri" header row (19 all-caps columns,
// no dates, no commission percentages).
const ADVANTAGE_HEADER: readonly string[] = [
  'ÜRÜN İSMİ', // 0
  'BARKOD', // 1
  'BEDEN', // 2
  'MODEL KODU', // 3
  'KATEGORİ', // 4
  'MARKA', // 5
  'STOK', // 6
  'KOMİSYON TARİFESİ', // 7
  '1 YILDIZ ÜST FİYAT', // 8
  '1 YILDIZ ALT FİYAT', // 9
  '2 YILDIZ ÜST FİYAT', // 10
  '2 YILDIZ ALT FİYAT', // 11
  '3 YILDIZ ÜST FİYAT', // 12
  'MÜŞTERİNİN GÖRDÜĞÜ FİYAT', // 13
  'TRENDYOL SATIŞ FİYATI', // 14
  'YENİ TSF (FİYAT GÜNCELLE)', // 15
  'Tarife Sonuna Kadar Uygula', // 16
  'EXTERNAL ID', // 17
  'TARİFE GRUBU', // 18
];

describe('resolveAdvantageTariffLayout', () => {
  it('resolves every column of the real Advantage header by name', () => {
    const layout = resolveAdvantageTariffLayout(ADVANTAGE_HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.barcode).toBe(1);
    expect(layout?.modelCode).toBe(3);
    expect(layout?.category).toBe(4);
    expect(layout?.stock).toBe(6);
    expect(layout?.commissionTariffFlag).toBe(7);
    expect(layout?.tier1Upper).toBe(8);
    expect(layout?.tier1Lower).toBe(9);
    expect(layout?.tier2Upper).toBe(10);
    expect(layout?.tier2Lower).toBe(11);
    expect(layout?.tier3Upper).toBe(12);
    expect(layout?.customerPrice).toBe(13);
    expect(layout?.currentPrice).toBe(14);
    expect(layout?.newTsf).toBe(15);
    expect(layout?.applyUntilEnd).toBe(16);
    expect(layout?.externalId).toBe(17);
    expect(layout?.tariffGroup).toBe(18);
  });

  it('returns null when a required column (BARKOD) is missing', () => {
    const header = ADVANTAGE_HEADER.filter((h) => h !== 'BARKOD');
    expect(resolveAdvantageTariffLayout(header)).toBeNull();
  });

  it('returns null when a star threshold column is missing', () => {
    const header = ADVANTAGE_HEADER.filter((h) => h !== '3 YILDIZ ÜST FİYAT');
    expect(resolveAdvantageTariffLayout(header)).toBeNull();
  });

  it('returns null on a non-Advantage header row', () => {
    expect(resolveAdvantageTariffLayout(['not', 'an', 'advantage', 'header'])).toBeNull();
  });
});
