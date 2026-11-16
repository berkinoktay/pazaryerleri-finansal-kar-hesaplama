// Trendyol's product commission tariff workbook as a format: the named sheet, one row per
// product with its current price and commission, the four price brackets shared by every
// period, and one block per period of the week (a date-range label and that period's four
// band commissions). The export writes the seller's choice back: the chosen price into
// the new price column and the window's tariff selection. The current price and every
// stored band's price are written values, so one the export could not write is refused
// at upload.

import { Decimal } from 'decimal.js';

import { bandPrice, parseStoredTariffBands } from '@pazarsync/profit';

import { requireStorableInt } from '../../column-range';
import { defineFormat, type WriteValueSpec } from '../../format';
import { requireWritableValue } from '../../write-columns';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import {
  trendyolCommissionTariffKeep,
  trendyolCommissionTariffLayout,
} from './commission-tariff.layout';
import { TARIFF_WINDOW_LABEL_UNIT, TRENDYOL_DEFAULT_NAMES, TRENDYOL_SHEET_NAMES } from './labels';
import { TARIFF_SELECTION_WRITE, TARIFF_WINDOW_FILE_UNIT } from './tariff-window';

/** The four price brackets of a row, shared by every period; a blank one is null. */
export interface CommissionTariffBrackets {
  readonly band1Lower: string | null;
  readonly band2Lower: string | null;
  readonly band2Upper: string | null;
  readonly band3Lower: string | null;
  readonly band3Upper: string | null;
  readonly band4Upper: string | null;
}

/**
 * One kept product row of the commission file. Prices and percents are decimal strings
 * as the file holds them; a blank current price or current commission reads as '0'.
 */
export interface CommissionTariffRow {
  readonly barcode: string;
  readonly stockCode: string | null;
  readonly productTitle: string;
  readonly category: string | null;
  readonly brand: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  /**
   * The commission base price, or null when the column is absent (older exports) or the
   * cell is blank. The compute falls back to the current price; the import keeps null.
   */
  readonly commissionBasePrice: string | null;
  readonly currentCommissionPct: string;
  readonly brackets: CommissionTariffBrackets;
  /** Each period block's four band commissions, in layout block order; a blank one is null. */
  readonly periodComms: readonly (readonly (string | null)[])[];
}

/** The commission file's write-back columns. */
export type CommissionTariffWriteKey = 'newTsf' | 'tariffSelection';

/** The new price is written with two decimal places. */
export const NEW_TSF_SCALE = 2;

/** The download base name; the window suffix (`-3-gunluk`) is added per file. */
const COMMISSION_EXPORT_BASE_NAME = 'urun-komisyon-tarifesi';

/** What a blank or unreadable decimal cell reads as, as the import always stored it. */
const BLANK_DECIMAL = '0';

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.COMMISSION_TARIFF;

/**
 * The new price column's write rule. The export writes a price chosen from the file (a
 * stored band's price, else the current price) into it, so the current price and every
 * stored band's price are read against it too.
 */
const NEW_TSF_WRITE: WriteValueSpec = { kind: 'number', scale: NEW_TSF_SCALE };

/** One band of one period, as the import stores it in the item's band JSON. */
type StoredBandJson = Record<string, string>;

/**
 * The band JSON of one period: the shared price brackets and that period's four
 * commissions. Band 1 has only a lower limit and band 4 only an upper limit; a band whose
 * commission is missing (blank, or past the end of `comms`) is skipped, the others keep
 * their keys; a null limit is left out of the JSON, never stored as null, which
 * `parseStoredTariffBands` reads back as null.
 */
export function bandsForPeriod(
  brackets: CommissionTariffBrackets,
  comms: readonly (string | null)[],
): StoredBandJson[] {
  const specs: readonly {
    readonly key: string;
    readonly lower: string | null;
    readonly upper: string | null;
    readonly comm: string | null;
  }[] = [
    { key: 'band1', lower: brackets.band1Lower, upper: null, comm: comms[0] ?? null },
    {
      key: 'band2',
      lower: brackets.band2Lower,
      upper: brackets.band2Upper,
      comm: comms[1] ?? null,
    },
    {
      key: 'band3',
      lower: brackets.band3Lower,
      upper: brackets.band3Upper,
      comm: comms[2] ?? null,
    },
    { key: 'band4', lower: null, upper: brackets.band4Upper, comm: comms[3] ?? null },
  ];
  const bands: StoredBandJson[] = [];
  for (const spec of specs) {
    if (spec.comm === null) continue;
    const json: StoredBandJson = { key: spec.key, commissionPct: spec.comm };
    if (spec.lower !== null) json['lowerLimit'] = spec.lower;
    if (spec.upper !== null) json['upperLimit'] = spec.upper;
    bands.push(json);
  }
  return bands;
}

/**
 * `value`, the current price of a row, when the export can write it as the new price
 * (`toFixed(2)`, the pick of a selected band the stored bands do not hold, or of one
 * with neither limit); the stored price stays the file's own text.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for a
 * current price the export could not write: a negative one, or one wider than its probe.
 */
function writableCurrentPrice(value: string): string {
  requireWritableValue(NEW_TSF_WRITE, new Decimal(value).toFixed(NEW_TSF_SCALE));
  return value;
}

/**
 * Checks the price of every band an import stores for the row, in every period block,
 * as the export reads it back (`parseStoredTariffBands` on the stored JSON) and writes
 * it (`bandPrice(...).toFixed(2)`). A band whose commission is blank in every block is
 * never stored, so its limits are never written and not checked. Every period block is
 * checked, also one whose label is blank on the first row and so is never stored.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for a
 * band price the export could not write.
 */
function requireWritableBands(
  brackets: CommissionTariffBrackets,
  periodComms: readonly (readonly (string | null)[])[],
  currentPrice: string,
): void {
  const current = new Decimal(currentPrice);
  for (const comms of periodComms) {
    for (const band of parseStoredTariffBands(bandsForPeriod(brackets, comms))) {
      requireWritableValue(NEW_TSF_WRITE, bandPrice(band, current).toFixed(NEW_TSF_SCALE));
    }
  }
}

export const trendyolCommissionTariffFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  sheet: { by: 'name', name: TRENDYOL_SHEET_NAMES.COMMISSION_TARIFF },
  layout: trendyolCommissionTariffLayout,
  keep: trendyolCommissionTariffKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): CommissionTariffRow => {
    const currentPrice = writableCurrentPrice(reader.decimal('currentPrice') ?? BLANK_DECIMAL);
    const brackets: CommissionTariffBrackets = {
      band1Lower: reader.decimal('band1Lower'),
      band2Lower: reader.decimal('band2Lower'),
      band2Upper: reader.decimal('band2Upper'),
      band3Lower: reader.decimal('band3Lower'),
      band3Upper: reader.decimal('band3Upper'),
      band4Upper: reader.decimal('band4Upper'),
    };
    const periodComms = reader
      .blocks('periods')
      .map((period) => [
        period.decimal('comm1'),
        period.decimal('comm2'),
        period.decimal('comm3'),
        period.decimal('comm4'),
      ]);
    requireWritableBands(brackets, periodComms, currentPrice);
    return {
      barcode: anchor,
      // The model code first, then the seller stock code, as the product import reads them.
      stockCode: reader.text('modelCode') ?? reader.text('sellerStockCode'),
      // A row keeps a readable title even when its barcode matches no product.
      productTitle: reader.text('productTitle') ?? anchor,
      category: reader.text('category'),
      brand: reader.text('brand'),
      stock: requireStorableInt(reader.int('stock', 'truncate')),
      currentPrice,
      commissionBasePrice: reader.decimal('commissionBasePrice'),
      currentCommissionPct: reader.decimal('currentCommission') ?? BLANK_DECIMAL,
      brackets,
      periodComms,
    };
  },
  writeBack: {
    newTsf: {
      target: { kind: 'column', key: 'newTsf' },
      value: NEW_TSF_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    tariffSelection: {
      target: { kind: 'column', key: 'tariffSelection' },
      value: TARIFF_SELECTION_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  // The choice needs both cells: the price and the window it applies to.
  exportRequires: [['newTsf'], ['tariffSelection']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.COMMISSION_TARIFF,
  filename: {
    kind: 'window',
    base: COMMISSION_EXPORT_BASE_NAME,
    labelUnit: TARIFF_WINDOW_LABEL_UNIT,
    fileUnit: TARIFF_WINDOW_FILE_UNIT,
  },
});
