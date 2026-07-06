// Vertical-agnostic export primitives shared by every campaign-tariff export path
// (product commission, Plus commission, and future discount/coupon verticals).
//
// A Trendyol tariff can carry MULTIPLE date-range sub-periods (e.g. a 3-day + a
// 4-day split week). The seller re-uploads to Trendyol PER WINDOW, so the seller's
// per-sub-period price selections are bucketed into up to THREE window files, each
// emitted only when it has a product:
//   • a whole-week "{week} Günlük Fiyat" file — products priced the SAME in every
//     sub-period (one row per product, applied to the whole week);
//   • a "{dayCount} Günlük Fiyat" file per sub-period — products with a
//     period-specific price (a product priced differently across the windows lands
//     in more than one file).
// A single-period (full-week) tariff yields one day-suffixed file.
//
// The two pure functions here — `planExportFiles` (the bucketing) and
// `bundleForDownload` (one lone .xlsx, or a .zip of several window files) — hold NO
// vertical-specific knowledge: the caller supplies the per-period barcode→price maps
// and the file base name. The byte-preserving cell patching itself lives per vertical
// (each writes its own cell set) on top of the plan this module produces.

import { zipSync } from 'fflate';

import { ConflictError } from '../lib/errors';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP_MIME = 'application/zip';

// A Trendyol tariff spans a week; the whole-week label falls back to this when the
// sub-periods' day counts don't add up (a header lacked its "(N Gün)" count).
const DEFAULT_WEEK_DAYS = 7;
// Trendyol's own "Tarife Seçimi" fill value for an N-day window, e.g. "7 Günlük
// Fiyat" (confirmed from Trendyol's filled exports); the seller re-uploads verbatim.
const WINDOW_SELECTION_LABEL_UNIT = 'Günlük Fiyat';
// Filename window tag unit, e.g. the "gunluk" in "urun-komisyon-tarifesi-3-gunluk".
const WINDOW_FILENAME_UNIT = 'gunluk';
const XLSX_EXTENSION = '.xlsx';
const ZIP_EXTENSION = '.zip';
// Strips a lone window file's "-{N}-gunluk.xlsx" tail so a multi-window download is
// named "{base}.zip" after the tariff, not after its first window file.
const WINDOW_XLSX_SUFFIX_RE = new RegExp(
  `(?:-\\d+-${WINDOW_FILENAME_UNIT})?\\${XLSX_EXTENSION}$`,
  'i',
);

/** Trendyol's "Tarife Seçimi" fill value for an N-day window, e.g. "3 Günlük Fiyat". */
function windowSelectionLabel(dayCount: number): string {
  return `${dayCount} ${WINDOW_SELECTION_LABEL_UNIT}`;
}

/** The "{dayCount}-gunluk" filename window tag. */
function windowSuffix(dayCount: number): string {
  return `${dayCount}-${WINDOW_FILENAME_UNIT}`;
}

/**
 * Builds an output file name from the vertical's base name and a plan suffix:
 * "{base}-{suffix}.xlsx" for a window file, or "{base}.xlsx" for the suffix-less
 * (zero-selection) fallback.
 */
export function exportFileName(baseName: string, suffix: string | null): string {
  return suffix === null
    ? `${baseName}${XLSX_EXTENSION}`
    : `${baseName}-${suffix}${XLSX_EXTENSION}`;
}

// ─── The pure grouping: which product goes into which file, as what ──────────

/** One sub-period's chosen prices, keyed by barcode (only products with a selection). */
export interface PeriodSelection {
  /** The N from "Tarih aralığı (N Gün)" (e.g. 3 or 4); null when the header lacked it. */
  readonly dayCount: number | null;
  /** barcode → chosen price (already `.toFixed(2)`). */
  readonly pricesByBarcode: ReadonlyMap<string, string>;
}

/** One product's price + selection label written into a window file. */
export interface RowPatch {
  readonly newPrice: string;
  readonly selection: string;
}

/** One output Excel: `suffix` is the "{dayCount}-gunluk" window tag (null only for the zero-selection fallback). */
export interface ExportFilePlan {
  readonly suffix: string | null;
  readonly rows: ReadonlyMap<string, RowPatch>;
  /**
   * Indices (into the input `periods`) this file covers: `[i]` for a single window
   * file, EVERY index for the whole-week file, `[0]` for a single-period tariff. A
   * vertical that writes per-period cells (e.g. Plus's per-period commission) uses
   * this to know which periods a file represents.
   */
  readonly periodIndices: readonly number[];
}

/**
 * Buckets per-sub-period selections into up to three window files (7-Gün / 3-Gün /
 * 4-Gün), each emitted only when it has a product. A product priced the SAME in every
 * sub-period is whole-week → the `"{week} Günlük Fiyat"` file; a period-specific price
 * goes in that period's `"{dayCount} Günlük Fiyat"` file (so a 3-Gün≠4-Gün product
 * lands in BOTH). A single-period (full-week) tariff yields one day-suffixed file.
 * `pricesByBarcode` holds only SELECTED products, so an unselected bucket yields no file.
 */
export function planExportFiles(periods: ReadonlyArray<PeriodSelection>): ExportFilePlan[] {
  if (periods.length === 0) return [];
  // The whole-week label = the sum of the sub-period day counts (3 + 4 = 7); falls
  // back to a Trendyol tariff week.
  const weekDayCount = periods.reduce((sum, p) => sum + (p.dayCount ?? 0), 0) || DEFAULT_WEEK_DAYS;

  // Full-week (single-period) tariff → one file, every product "{dayCount} Günlük Fiyat".
  // Still carries the "{dayCount}-gunluk" filename suffix so a lone (non-zip) download
  // tells the seller which window it is.
  if (periods.length === 1) {
    const only = periods[0];
    if (only === undefined || only.pricesByBarcode.size === 0) return [];
    const dayCount = only.dayCount ?? weekDayCount;
    const rows = new Map<string, RowPatch>();
    for (const [barcode, price] of only.pricesByBarcode) {
      rows.set(barcode, { newPrice: price, selection: windowSelectionLabel(dayCount) });
    }
    return [{ suffix: windowSuffix(dayCount), rows, periodIndices: [0] }];
  }

  const wholeWeek = new Map<string, RowPatch>();
  const perPeriod = periods.map(() => new Map<string, RowPatch>());

  const barcodes = new Set<string>();
  for (const period of periods) for (const bc of period.pricesByBarcode.keys()) barcodes.add(bc);

  for (const barcode of barcodes) {
    const prices = periods.map((p) => p.pricesByBarcode.get(barcode) ?? null);
    const chosen = prices.filter((p): p is string => p !== null);
    const first = chosen[0];
    if (first === undefined) continue;

    // Selected in every sub-period at the same price → one whole-week ("7 Günlük") row.
    if (chosen.length === periods.length && chosen.every((p) => p === first)) {
      wholeWeek.set(barcode, { newPrice: first, selection: windowSelectionLabel(weekDayCount) });
      continue;
    }
    // Otherwise each selected period's price goes in its own window file.
    prices.forEach((price, i) => {
      if (price === null) return;
      const dayCount = periods[i]?.dayCount ?? weekDayCount;
      perPeriod[i]?.set(barcode, { newPrice: price, selection: windowSelectionLabel(dayCount) });
    });
  }

  const files: ExportFilePlan[] = [];
  periods.forEach((period, i) => {
    const rows = perPeriod[i];
    if (rows === undefined || rows.size === 0) return;
    files.push({ suffix: windowSuffix(period.dayCount ?? weekDayCount), rows, periodIndices: [i] });
  });
  if (wholeWeek.size > 0) {
    files.push({
      suffix: windowSuffix(weekDayCount),
      rows: wholeWeek,
      // The whole-week file represents every sub-period (one price, but one commission
      // cell per period for verticals that write them).
      periodIndices: periods.map((_, i) => i),
    });
  }
  return files;
}

// ─── One HTTP download from the produced files ───────────────────────────────

export interface ExportFile {
  readonly filename: string;
  readonly file: Buffer;
}

export interface DownloadBundle {
  readonly body: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

/**
 * Packages the per-period export files into ONE HTTP download: a lone file streams as
 * its `.xlsx`; a split week's several window files bundle into a single `.zip` so one
 * "Dışa aktar" click delivers them all. Throws `ConflictError` when there are no files
 * (a source-less / empty tariff — already guarded upstream).
 */
export function bundleForDownload(files: ReadonlyArray<ExportFile>): DownloadBundle {
  const [first, ...rest] = files;
  if (first === undefined) {
    throw new ConflictError('Tariff produced no export files');
  }
  if (rest.length === 0) {
    return { body: first.file, filename: first.filename, contentType: XLSX_MIME };
  }
  const zippable: Record<string, Uint8Array> = {};
  for (const f of files) zippable[f.filename] = new Uint8Array(f.file);
  return {
    body: Buffer.from(zipSync(zippable)),
    // Name the zip after the tariff, not the first window file: strip the trailing
    // "-{N}-gunluk" window suffix so a split week downloads as "{base}.zip".
    filename: first.filename.replace(WINDOW_XLSX_SUFFIX_RE, ZIP_EXTENSION),
    contentType: ZIP_MIME,
  };
}
