// Resolves the column layout of a Trendyol "Plus Komisyon" sheet from its header
// row. Unlike the product commission sheet (variable-width, positional), the Plus
// sheet is a single-period fixed layout — but we still resolve every column BY
// HEADER NAME so a future column reorder does not silently shift the mapping.
//
// Shared by the import (read) and export (patch) paths so both agree on where a
// given column lives.

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

export interface PlusTariffLayout {
  // Identity + current pricing.
  readonly productTitle: number;
  readonly barcode: number;
  readonly sellerStockCode: number;
  readonly size: number;
  readonly modelCode: number;
  readonly category: number;
  readonly brand: number;
  readonly stock: number;
  readonly currentPrice: number;
  readonly commissionBasePrice: number;
  readonly currentCommission: number;
  // The single Plus offer.
  readonly plusPriceUpperLimit: number;
  readonly plusCommissionPct: number;
  readonly plusCommissionBasePrice: number;
  // The single 7-day period.
  readonly periodLabel: number;
  readonly dayCount: number;
  // Passthrough identifiers.
  readonly externalId: number;
  readonly tariffGroup: number;
  readonly cancelled: number;
  // Export write-back targets — the seller's opt-in cells (may be absent in an
  // odd file; -1 when so, and export skips a missing target).
  readonly plusPriceSelection: number;
  readonly tariffSelection: number;
  readonly computedCommission: number;
}

// The Plus period header carries the day count, e.g. "Tarih Aralığı (7 Gün)"
// (note the capital A, unlike the product sheet's "Tarih aralığı"). Case-insensitive
// on the word to tolerate either casing.
const PERIOD_HEADER_RE = /^Tarih Aral[ıi]ğı \((\d+) Gün\)$/i;

function findPeriod(headers: readonly string[]): { col: number; dayCount: number } | null {
  for (let i = 0; i < headers.length; i += 1) {
    const match = PERIOD_HEADER_RE.exec(headers[i] ?? '');
    if (match?.[1] !== undefined) return { col: i, dayCount: Number(match[1]) };
  }
  return null;
}

/**
 * Resolves the Plus layout from the header row, or returns null when the sheet is
 * not a recognizable Trendyol Plus export (missing a required column or the
 * period header). The caller turns null into INVALID_PLUS_TARIFF_FORMAT.
 */
export function resolvePlusTariffLayout(headerRow: readonly unknown[]): PlusTariffLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const period = findPeriod(headers);
  if (period === null) return null;

  const layout: PlusTariffLayout = {
    productTitle: col('Ürün İsmi'),
    barcode: col('Barkod'),
    sellerStockCode: col('Satıcı Stok Kodu'),
    size: col('Beden'),
    modelCode: col('Model Kodu'),
    category: col('Kategori'),
    brand: col('Marka'),
    stock: col('Stok'),
    currentPrice: col('Güncel TSF'),
    commissionBasePrice: col('Komisyona Esas Fiyat'),
    currentCommission: col('Güncel Komisyon'),
    plusPriceUpperLimit: col('Plus Fiyat Üst Limiti'),
    plusCommissionPct: col('Plus Komisyon Teklifi'),
    plusCommissionBasePrice: col('Plus Komisyona Esas Fiyatı'),
    periodLabel: period.col,
    dayCount: period.dayCount,
    externalId: col('External Id'),
    tariffGroup: col('Tarife Grubu'),
    cancelled: col('İptal'),
    plusPriceSelection: col('Plus Fiyat Seçimi'),
    tariffSelection: col('Tarife Seçimi'),
    computedCommission: col('Hesaplanan Komisyon (7 Gün)'),
  };

  // Required for a usable Plus tariff: identity + the offer numbers. The
  // export-target columns are resolved but not required at import (a file could
  // omit them; export just skips a -1 target).
  const required = [
    layout.barcode,
    layout.currentPrice,
    layout.currentCommission,
    layout.plusPriceUpperLimit,
    layout.plusCommissionPct,
  ];
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
