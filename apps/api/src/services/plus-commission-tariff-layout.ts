// Resolves the column layout of a Trendyol "Plus Komisyon" sheet from its header
// row. Like the product commission sheet, the Plus export is variable-WIDTH: a
// single upload can carry MULTIPLE date-range periods (e.g. a 3-day + a 4-day
// block), each a "Tarih Aralığı (N Gün)" header immediately followed by its own
// "Plus Komisyon Teklifi" offer column. All the other columns (identity + current
// pricing + the shared Plus price ceiling / commission base + passthrough ids) are
// resolved BY HEADER NAME so a column reorder does not silently shift the mapping.
//
// Shared by the import (read) and export (patch) paths so both agree on where a
// given column lives for any period configuration.

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

export interface PlusPeriodColumns {
  /** The N from "Tarih Aralığı (N Gün)". */
  readonly dayCount: number;
  /** Column holding the date-range label (a data cell, same on every row). */
  readonly labelCol: number;
  /** Column holding this period's "Plus Komisyon Teklifi" offer percent (labelCol + 1). */
  readonly offerCol: number;
  /**
   * "Hesaplanan Komisyon (N Gün)" export write-back target for this period; -1 when
   * absent (older files predate the column). Export skips a missing target; import
   * never reads it.
   */
  readonly computedCommissionCol: number;
}

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
  // Shared Plus offer columns (one across every period).
  readonly plusPriceUpperLimit: number;
  readonly plusCommissionBasePrice: number;
  // Passthrough identifiers.
  readonly externalId: number;
  readonly tariffGroup: number;
  readonly cancelled: number;
  // Export write-back targets — the seller's opt-in cells (may be absent in an
  // odd file; -1 when so, and export skips a missing target).
  readonly plusPriceSelection: number;
  readonly tariffSelection: number;
  // One entry per period block, in sheet order.
  readonly periods: ReadonlyArray<PlusPeriodColumns>;
}

// The Plus period header carries the day count, e.g. "Tarih Aralığı (7 Gün)"
// (note the capital A, unlike the product sheet's "Tarih aralığı"). Case-insensitive
// on the word to tolerate either casing.
const PERIOD_HEADER_RE = /^Tarih Aral[ıi]ğı \((\d+) Gün\)$/i;

// The per-period offer percent header. It sits immediately after each period label;
// in a multi-period file this header repeats once per period, so it CANNOT be
// located by name — only by its fixed adjacency to the period label.
const PLUS_OFFER_HEADER = 'Plus Komisyon Teklifi';

/**
 * Collects every "Tarih Aralığı (N Gün)" period block from the header row. Each
 * period's offer percent must sit in the very next column ("Plus Komisyon Teklifi");
 * if that adjacency is broken the sheet is not a recognizable Plus export, so the
 * whole layout is rejected (returns null). Returns null when no period is present.
 */
function findPeriods(headers: readonly string[]): PlusPeriodColumns[] | null {
  const periods: PlusPeriodColumns[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const match = PERIOD_HEADER_RE.exec(headers[i] ?? '');
    if (match?.[1] === undefined) continue;
    const dayCount = Number(match[1]);
    const offerCol = i + 1;
    if (headers[offerCol] !== normalizeHeader(PLUS_OFFER_HEADER)) return null;
    periods.push({
      dayCount,
      labelCol: i,
      offerCol,
      computedCommissionCol: findHeader(headers, `Hesaplanan Komisyon (${dayCount} Gün)`),
    });
  }
  return periods.length === 0 ? null : periods;
}

/**
 * Resolves the Plus layout from the header row, or returns null when the sheet is
 * not a recognizable Trendyol Plus export (missing a required column, a broken
 * period/offer adjacency, or no period header). The caller turns null into
 * INVALID_PLUS_TARIFF_FORMAT.
 */
export function resolvePlusTariffLayout(headerRow: readonly unknown[]): PlusTariffLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const periods = findPeriods(headers);
  if (periods === null) return null;

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
    plusCommissionBasePrice: col('Plus Komisyona Esas Fiyatı'),
    externalId: col('External Id'),
    tariffGroup: col('Tarife Grubu'),
    cancelled: col('İptal'),
    plusPriceSelection: col('Plus Fiyat Seçimi'),
    tariffSelection: col('Tarife Seçimi'),
    periods,
  };

  // Required for a usable Plus tariff: identity + the current offer numbers. The
  // export-target columns are resolved but not required at import (a file could
  // omit them; export just skips a -1 target). Each period's offer column was
  // already validated non-negative by findPeriods.
  const required = [
    layout.barcode,
    layout.currentPrice,
    layout.currentCommission,
    layout.plusPriceUpperLimit,
  ];
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
