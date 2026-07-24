import { describe, expect, it } from 'vitest';
import { resolveDiscountListLayout } from '@/services/discount-list-layout';

const FULL_HEADER = [
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

describe('resolveDiscountListLayout', () => {
  it('resolves every column of the real Trendyol header', () => {
    const layout = resolveDiscountListLayout(FULL_HEADER);
    expect(layout).not.toBeNull();
    expect(layout?.barcode).toBe(4);
    expect(layout?.currentPrice).toBe(6);
    expect(layout?.included).toBe(8);
  });
  it('survives a column reorder (header-name resolution)', () => {
    const layout = resolveDiscountListLayout([...FULL_HEADER].reverse());
    expect(layout?.barcode).toBe(4);
    expect(layout?.included).toBe(0);
  });
  it('returns null when a required column is missing', () => {
    expect(resolveDiscountListLayout(FULL_HEADER.filter((h) => h !== 'Barkod'))).toBeNull();
    expect(
      resolveDiscountListLayout(FULL_HEADER.filter((h) => h !== 'Kampayaya Dahil Edilsin Mi?')),
    ).toBeNull();
  });
});
