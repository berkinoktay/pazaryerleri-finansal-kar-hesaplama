// Resolves the column layout of a Trendyol "İndirimler" (Promosyon > İndirimler)
// product-selection sheet from its header row. Every column is resolved BY HEADER
// NAME so a future reorder does not silently shift the mapping. Shared by the
// import (read) and export (patch) paths so both agree on where a column lives.
//
// The sheet is the SAME for every discount type — it only selects participating
// products; the discount configuration lives on the PazarSync list row. NOTE the
// participation header carries Trendyol's own typo ("Kampayaya", not "Kampanyaya");
// we match it verbatim, and also accept the corrected spelling defensively.

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

export const DISCOUNT_SHEET_NAME = 'Ürünler';
/** Values Trendyol writes into the participation column. */
export const DISCOUNT_INCLUDED_YES = 'Evet';
export const DISCOUNT_INCLUDED_NO = 'Hayır';

export interface DiscountListLayout {
  readonly externalId: number;
  readonly productTitle: number;
  readonly brand: number;
  readonly color: number;
  readonly barcode: number;
  readonly modelCode: number;
  readonly currentPrice: number;
  /** "Kampayaya Dahil Edilsin Mi?" — the ONE column export writes back. */
  readonly included: number;
}

/**
 * Resolves the layout from the header row, or returns null when the sheet is not a
 * recognizable Trendyol Discounts export. The caller turns null into
 * INVALID_DISCOUNT_FORMAT.
 */
export function resolveDiscountListLayout(
  headerRow: readonly unknown[],
): DiscountListLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const layout: DiscountListLayout = {
    externalId: col('Trendyol Ürün ID'),
    productTitle: col('Ürün Bilgisi'),
    brand: col('Marka'),
    color: col('Renk'),
    barcode: col('Barkod'),
    modelCode: col('Model Kodu'),
    currentPrice: col('Güncel Satış Fiyatı'),
    // Trendyol's header has a typo; match it first, fall back to the correct form.
    included:
      col('Kampayaya Dahil Edilsin Mi?') >= 0
        ? col('Kampayaya Dahil Edilsin Mi?')
        : col('Kampanyaya Dahil Edilsin Mi?'),
  };

  // Required: identity (barcode) + the price the estimates anchor on + the
  // participation column (without it the vertical's whole export is impossible).
  const required = [layout.barcode, layout.currentPrice, layout.included];
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
