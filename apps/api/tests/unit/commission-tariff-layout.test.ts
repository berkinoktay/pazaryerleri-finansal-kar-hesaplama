import { describe, expect, it } from 'vitest';

import { resolveTariffLayout } from '@/services/commission-tariff-layout';

// Columns A-N — identity (A-H) + the 4 price brackets (I-N). Stable across files.
const FIXED: readonly string[] = [
  'ÜRÜN İSMİ',
  'BARKOD',
  'SATICI STOK KODU',
  'BEDEN',
  'MODEL KODU',
  'KATEGORİ',
  'MARKA',
  'STOK',
  '1.Fiyat Alt Limit',
  '2.Fiyat Üst Limiti',
  '2.Fiyat Alt Limit',
  '3.Fiyat Üst Limiti',
  '3.Fiyat Alt Limit',
  '4.Fiyat Üst Limiti',
];

const COMMS: readonly string[] = ['1.KOMİSYON', '2.KOMİSYON', '3.KOMİSYON', '4.KOMİSYON'];

describe('resolveTariffLayout', () => {
  it('resolves a two-period (35-column) layout', () => {
    const header = [
      ...FIXED,
      'Tarih aralığı (3 Gün)',
      ...COMMS,
      'Tarih aralığı (4 Gün)',
      ...COMMS,
      'KOMİSYONA ESAS FİYAT',
      'GÜNCEL KOMİSYON',
      'GÜNCEL TSF',
      'YENİ TSF (FİYAT GÜNCELLE)',
      'Hesaplanan Komisyon (3 Gün)',
      'Hesaplanan Komisyon (4 Gün)',
      'Tarife Seçimi',
      'FIRST EXTERNAL ID',
      'SECOND EXTERNAL ID',
      'FULL EXTERNAL ID',
      'TARİFE GRUBU',
    ];

    const layout = resolveTariffLayout(header);
    expect(layout).not.toBeNull();
    expect(layout?.periods.map((p) => p.dayCount)).toEqual([3, 4]);
    expect(layout?.periods[0]?.commCols).toEqual([15, 16, 17, 18]);
    expect(layout?.periods[1]?.commCols).toEqual([20, 21, 22, 23]);
    expect(layout?.currentCommission).toBe(25);
    expect(layout?.currentPrice).toBe(26);
    expect(layout?.newTsf).toBe(27);
    expect(layout?.tariffSelection).toBe(30);
  });

  it('resolves a one-period (27-column) layout with shifted tail columns', () => {
    const header = [
      ...FIXED,
      'Tarih aralığı (7 Gün)',
      ...COMMS,
      'KOMİSYONA ESAS FİYAT',
      'GÜNCEL KOMİSYON',
      'GÜNCEL TSF',
      'YENİ TSF (FİYAT GÜNCELLE)',
      'Hesaplanan Komisyon (7 Gün)',
      'Tarife Seçimi',
      'EXTERNAL ID',
      'TARİFE GRUBU',
    ];

    const layout = resolveTariffLayout(header);
    expect(layout).not.toBeNull();
    expect(layout?.periods.map((p) => p.dayCount)).toEqual([7]);
    expect(layout?.currentCommission).toBe(20);
    expect(layout?.currentPrice).toBe(21);
    expect(layout?.newTsf).toBe(22);
    expect(layout?.tariffSelection).toBe(24);
  });

  it('returns null when the fixed columns are missing', () => {
    expect(resolveTariffLayout(['not', 'a', 'tariff', 'header'])).toBeNull();
  });

  it('returns null when there is no period block', () => {
    const header = [...FIXED, 'GÜNCEL TSF', 'YENİ TSF (FİYAT GÜNCELLE)', 'Tarife Seçimi'];
    expect(resolveTariffLayout(header)).toBeNull();
  });

  it('returns null when a tail column is missing', () => {
    const header = [...FIXED, 'Tarih aralığı (4 Gün)', ...COMMS, 'GÜNCEL TSF'];
    expect(resolveTariffLayout(header)).toBeNull();
  });
});
