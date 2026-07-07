import { Prisma } from '@pazarsync/db';
import { describe, expect, it } from 'vitest';

import { resolveFlashExportCells } from '@/services/flash-product-export.service';

// The pure write-back resolver for one Flash row. The authoritative export contract
// (Berkin): the "Güncellenecek Fiyat" (J) label is "24 Saat" for an H24 offer, "3 Saat"
// for an H3 offer, and "Senin Belirlediğin Flaş Fiyatı" for a custom price. The numeric
// custom price only lands in the "Senin Belirlediğin Flaş Fiyatı" (M) cell on a custom
// selection — an offer selection leaves M null (Trendyol reads its own K/L price).

describe('resolveFlashExportCells', () => {
  it('resolves an H24 offer to the "24 Saat" label with no custom price', () => {
    expect(resolveFlashExportCells({ selectedOffer: 'H24', customPrice: null })).toEqual({
      updateLabel: '24 Saat',
      customPrice: null,
    });
  });

  it('resolves an H3 offer to the "3 Saat" label with no custom price', () => {
    expect(resolveFlashExportCells({ selectedOffer: 'H3', customPrice: null })).toEqual({
      updateLabel: '3 Saat',
      customPrice: null,
    });
  });

  it('resolves a custom price to the "Senin Belirlediğin Flaş Fiyatı" label + the numeric price (2dp)', () => {
    expect(
      resolveFlashExportCells({ selectedOffer: null, customPrice: new Prisma.Decimal('179.47') }),
    ).toEqual({ updateLabel: 'Senin Belirlediğin Flaş Fiyatı', customPrice: '179.47' });
  });

  it('normalizes the custom price to 2dp', () => {
    expect(
      resolveFlashExportCells({ selectedOffer: null, customPrice: new Prisma.Decimal('179') }),
    ).toEqual({ updateLabel: 'Senin Belirlediğin Flaş Fiyatı', customPrice: '179.00' });
  });

  it('prefers the custom price over an offer when both are set (custom wins)', () => {
    expect(
      resolveFlashExportCells({ selectedOffer: 'H24', customPrice: new Prisma.Decimal('150.00') }),
    ).toEqual({ updateLabel: 'Senin Belirlediğin Flaş Fiyatı', customPrice: '150.00' });
  });

  it('returns null for a row with no selection (neither offer nor custom)', () => {
    expect(resolveFlashExportCells({ selectedOffer: null, customPrice: null })).toBeNull();
  });
});
