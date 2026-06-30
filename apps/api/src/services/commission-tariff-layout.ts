// Resolves the column layout of a Trendyol "Ürün Komisyon Tarifeleri" sheet from
// its header row. The layout is NOT fixed: the GÜNCEL TSF / YENİ TSF / Tarife
// Seçimi columns shift by how many period blocks the file carries (a 1-period
// file is 27 columns, a 2-period file 35). Columns A-N (identity + 4 price
// brackets) are stable; each period is a "Tarih aralığı (N Gün)" header followed
// by its 4 commission columns; the tail columns are located by header name.
//
// Shared by the import (read) and export (patch) paths so both agree on where a
// given column lives for any period configuration.

// ─── Fixed columns A-N (identical across every export we have seen) ──────────

export const FIXED_COLUMNS = {
  productTitle: 0,
  barcode: 1,
  sellerStockCode: 2,
  size: 3,
  modelCode: 4,
  category: 5,
  brand: 6,
  stock: 7,
  band1Lower: 8,
  band2Upper: 9,
  band2Lower: 10,
  band3Upper: 11,
  band3Lower: 12,
  band4Upper: 13,
} as const;

const FIXED_HEADERS: ReadonlyArray<readonly [number, string]> = [
  [FIXED_COLUMNS.barcode, 'BARKOD'],
  [FIXED_COLUMNS.modelCode, 'MODEL KODU'],
  [FIXED_COLUMNS.band1Lower, '1.Fiyat Alt Limit'],
  [FIXED_COLUMNS.band4Upper, '4.Fiyat Üst Limiti'],
];

export interface PeriodColumns {
  /** The N from "Tarih aralığı (N Gün)". */
  readonly dayCount: number;
  /** Column holding the date-range label (a data cell, same on every row). */
  readonly labelCol: number;
  /** The four commission columns for this period (1..4.KOMİSYON). */
  readonly commCols: readonly [number, number, number, number];
}

export interface TariffLayout {
  readonly fixed: typeof FIXED_COLUMNS;
  readonly currentPrice: number;
  readonly currentCommission: number;
  readonly newTsf: number;
  readonly tariffSelection: number;
  readonly periods: ReadonlyArray<PeriodColumns>;
}

const PERIOD_HEADER_RE = /^Tarih aralığı \((\d+) Gün\)$/;

// Collapse whitespace (JS \s already covers NBSP U+00A0) + NFC-normalize so header
// comparisons are exact regardless of stray spacing.
function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

function findHeader(headers: readonly string[], target: string): number {
  return headers.indexOf(norm(target));
}

/**
 * Resolves the layout from the header row, or returns null when the sheet is not
 * a recognizable Trendyol tariff export (missing fixed columns, no period block,
 * or a missing tail column). The caller turns null into INVALID_TARIFF_FORMAT.
 */
export function resolveTariffLayout(headerRow: readonly unknown[]): TariffLayout | null {
  const headers = headerRow.map(norm);

  for (const [idx, expected] of FIXED_HEADERS) {
    if (headers[idx] !== norm(expected)) return null;
  }

  const periods: PeriodColumns[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const match = PERIOD_HEADER_RE.exec(headers[i] ?? '');
    if (match === null || match[1] === undefined) continue;
    periods.push({
      dayCount: Number(match[1]),
      labelCol: i,
      commCols: [i + 1, i + 2, i + 3, i + 4],
    });
  }
  if (periods.length === 0) return null;

  const currentPrice = findHeader(headers, 'GÜNCEL TSF');
  const currentCommission = findHeader(headers, 'GÜNCEL KOMİSYON');
  const newTsf = findHeader(headers, 'YENİ TSF (FİYAT GÜNCELLE)');
  const tariffSelection = findHeader(headers, 'Tarife Seçimi');
  if (currentPrice < 0 || currentCommission < 0 || newTsf < 0 || tariffSelection < 0) {
    return null;
  }

  return {
    fixed: FIXED_COLUMNS,
    currentPrice,
    currentCommission,
    newTsf,
    tariffSelection,
    periods,
  };
}
