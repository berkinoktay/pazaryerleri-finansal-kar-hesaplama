// Trendyol's Plus commission tariff workbook as a format: the named sheet, one row per
// product with its current price and commission, the Plus price ceiling, and one block
// per period of the week (a date-range label and the Plus commission offer of that
// period). The export writes the seller's opt-in back: the Plus price (the custom one,
// else the ceiling), the window's tariff selection, the offer of every period the file
// covers into that period's computed commission column, and the no-cancel label. The
// ceiling and the offers are written values, so one the export could not write is
// refused at upload.

import { Decimal } from 'decimal.js';

import { requireStorableInt } from '../../column-range';
import { defineFormat, type WriteValueSpec } from '../../format';
import { requireWritableValue } from '../../write-columns';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import {
  NO_LABEL,
  TARIFF_WINDOW_LABEL_UNIT,
  TRENDYOL_DEFAULT_NAMES,
  TRENDYOL_SHEET_NAMES,
} from './labels';
import {
  trendyolPlusCommissionTariffKeep,
  trendyolPlusCommissionTariffLayout,
} from './plus-commission-tariff.layout';
import { TARIFF_SELECTION_WRITE, TARIFF_WINDOW_FILE_UNIT } from './tariff-window';

/**
 * One kept product row of the Plus file. Prices and percents are decimal strings as
 * the file holds them; a blank one reads as '0'.
 */
export interface PlusCommissionTariffRow {
  readonly barcode: string;
  readonly stockCode: string | null;
  readonly productTitle: string;
  readonly category: string | null;
  readonly brand: string | null;
  readonly size: string | null;
  readonly modelCode: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  readonly commissionBasePrice: string;
  readonly currentCommissionPct: string;
  readonly plusPriceUpperLimit: string;
  readonly plusCommissionBasePrice: string;
  readonly externalId: string | null;
  readonly tariffGroup: string | null;
  readonly cancelled: boolean;
  /** The Plus commission offer of each period block, in layout block order. */
  readonly periodOffers: readonly string[];
}

/** The Plus file's write-back columns. */
export type PlusCommissionTariffWriteKey =
  | 'plusPriceSelection'
  | 'tariffSelection'
  | 'computedCommission'
  | 'cancelled';

/** The Plus price is written with two decimal places. */
export const PLUS_PRICE_SCALE = 2;

/**
 * The scale of a stored period offer (`plus_commission_pct`, numeric(6,4)). The database
 * rounds the file's offer to it, and the export writes that stored value.
 */
const PLUS_OFFER_SCALE = 4;

/** The download base name; the window suffix (`-7-gunluk`) is added per file. */
const PLUS_EXPORT_BASE_NAME = 'plus-komisyon-tarifesi';

/** What a blank or unreadable decimal cell reads as, as the import always stored it. */
const BLANK_DECIMAL = '0';

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.PLUS_COMMISSION_TARIFF;

/** The Plus price column's write rule; every Plus price ceiling is read against it too. */
const PLUS_PRICE_SELECTION_WRITE: WriteValueSpec = {
  kind: 'number',
  scale: PLUS_PRICE_SCALE,
};

/**
 * The computed commission column's write rule: the period's offer percent with every
 * stored digit (`Decimal.toFixed()`). Every period offer is read against it too.
 */
const COMPUTED_COMMISSION_WRITE: WriteValueSpec = { kind: 'number' };

/** The cancel column's write rule: the opt-in confirms the offer, so it is never cancelled. */
const CANCELLED_WRITE: WriteValueSpec = { kind: 'text', allow: [NO_LABEL] };

/**
 * `value`, the Plus price ceiling of a row, when the export can write it as the Plus
 * price (`new Decimal(value).toFixed(2)`, the pick of a selected item without a custom
 * price); the stored ceiling stays the file's own text.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for a
 * ceiling the export could not write: a negative one, or one wider than its probe.
 */
function writableCeiling(value: string): string {
  requireWritableValue(PLUS_PRICE_SELECTION_WRITE, new Decimal(value).toFixed(PLUS_PRICE_SCALE));
  return value;
}

/**
 * `value`, a period's offer percent, when the export can write it as the computed
 * commission; the stored offer stays the file's own text.
 *
 * The export writes the stored offer, which the database rounded to PLUS_OFFER_SCALE, so
 * the check reads the rounded value: an Excel float residue such as 15.400000000000002 is
 * stored and written as 15.4 and passes. Every period block of the row is checked, also
 * one whose label is blank on the first row and so is never stored.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for an
 * offer the export could not write: a negative one, or one wider than its probe.
 */
function writableOffer(value: string): string {
  const stored = new Decimal(value).toDecimalPlaces(PLUS_OFFER_SCALE);
  requireWritableValue(COMPUTED_COMMISSION_WRITE, stored.toFixed());
  return value;
}

export const trendyolPlusCommissionTariffFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  sheet: { by: 'name', name: TRENDYOL_SHEET_NAMES.PLUS_COMMISSION_TARIFF },
  layout: trendyolPlusCommissionTariffLayout,
  keep: trendyolPlusCommissionTariffKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): PlusCommissionTariffRow => {
    const modelCode = reader.text('modelCode');
    const currentPrice = reader.decimal('currentPrice');
    const plusPriceUpperLimit = reader.decimal('plusPriceUpperLimit');
    return {
      barcode: anchor,
      // The model code first, then the seller stock code, as the product import reads them.
      stockCode: modelCode ?? reader.text('sellerStockCode'),
      // A row keeps a readable title even when its barcode matches no product.
      productTitle: reader.text('productTitle') ?? anchor,
      category: reader.text('category'),
      brand: reader.text('brand'),
      size: reader.text('size'),
      modelCode,
      stock: requireStorableInt(reader.int('stock', 'truncate')),
      currentPrice: currentPrice ?? BLANK_DECIMAL,
      commissionBasePrice: reader.decimal('commissionBasePrice') ?? currentPrice ?? BLANK_DECIMAL,
      currentCommissionPct: reader.decimal('currentCommission') ?? BLANK_DECIMAL,
      plusPriceUpperLimit: writableCeiling(plusPriceUpperLimit ?? BLANK_DECIMAL),
      plusCommissionBasePrice:
        reader.decimal('plusCommissionBasePrice') ?? plusPriceUpperLimit ?? BLANK_DECIMAL,
      externalId: reader.text('externalId'),
      tariffGroup: reader.text('tariffGroup'),
      // A number cell: the number 1 cancels, the text "0" does not.
      cancelled: reader.numericFlag('cancelled'),
      periodOffers: reader
        .blocks('periods')
        .map((period) => writableOffer(period.decimal('offer') ?? BLANK_DECIMAL)),
    };
  },
  writeBack: {
    plusPriceSelection: {
      target: { kind: 'column', key: 'plusPriceSelection' },
      value: PLUS_PRICE_SELECTION_WRITE,
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
    computedCommission: {
      target: { kind: 'blockLookup', block: 'periods', lookup: 'computedCommission' },
      value: COMPUTED_COMMISSION_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    cancelled: {
      target: { kind: 'column', key: 'cancelled' },
      value: CANCELLED_WRITE,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  // The opt-in is the Plus price or the tariff selection; a file with neither column
  // cannot carry it.
  exportRequires: [['plusPriceSelection', 'tariffSelection']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.PLUS_COMMISSION_TARIFF,
  filename: {
    kind: 'window',
    base: PLUS_EXPORT_BASE_NAME,
    labelUnit: TARIFF_WINDOW_LABEL_UNIT,
    fileUnit: TARIFF_WINDOW_FILE_UNIT,
  },
});
