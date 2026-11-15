// Trendyol's advantage product label workbook (Avantajli Urun Etiketleri, the star
// labelled products sheet) as a format: the named sheet, one row per product with its
// three star tiers (each a price range that earns a badge), and one write-back column,
// the new sale price. The file carries no commission and no dates; the reduced
// commission is read from the seller's commission tariff at compute time. Choosing a
// tier writes that tier's upper limit as the new sale price, so an upper limit the
// export could not write is refused at upload.

import { Decimal } from 'decimal.js';

import type { ColumnKey, RowReader } from '@pazarsync/spreadsheet';

import type { StarTierKey } from '../../../services/advantage-tariff.types';
import { defineFormat, type WriteValueSpec } from '../../format';
import { WorkbookInvariantError } from '../../workbook-errors';
import { requireWritableValue } from '../../write-columns';
import { TRENDYOL_FORMAT_SUMMARIES } from '../registry';
import {
  trendyolAdvantageTariffKeep,
  trendyolAdvantageTariffLayout,
} from './advantage-tariff.layout';
import {
  APPLY_UNTIL_END_YES_FOLDED,
  TARIFF_FLAG_YES_FOLDED,
  TRENDYOL_DEFAULT_NAMES,
  TRENDYOL_SHEET_NAMES,
} from './labels';

/**
 * One star tier as the import stores it: its key, its upper limit and, when the file
 * has a readable one, its lower limit. A missing lower limit is left out, never null
 * (`parseStarTiers` reads an absent one back as null). Limits are decimal strings as
 * the file holds them.
 */
export type StoredStarTier = {
  readonly key: StarTierKey;
  readonly upperLimit: string;
  readonly lowerLimit?: string;
};

/** One kept product row of the advantage file. Prices are decimal strings as the file holds them. */
export interface AdvantageTariffRow {
  readonly barcode: string;
  readonly stockCode: string | null;
  readonly productTitle: string;
  readonly category: string | null;
  readonly brand: string | null;
  readonly size: string | null;
  readonly modelCode: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  readonly customerPrice: string;
  readonly hasCommissionTariff: boolean;
  readonly starTiers: readonly StoredStarTier[];
  readonly applyUntilEnd: boolean;
  readonly externalId: string | null;
  readonly tariffGroup: string | null;
}

/** The advantage file's one write-back column: the new sale price. */
export type AdvantageTariffWriteKey = 'newTsf';

/** The new sale price is written with two decimal places. */
export const ADVANTAGE_PRICE_SCALE = 2;

const SUMMARY = TRENDYOL_FORMAT_SUMMARIES.ADVANTAGE_TARIFF;

/** The new sale price column's write rule; every stored tier upper limit is read against it too. */
const NEW_TSF_WRITE: WriteValueSpec = { kind: 'number', scale: ADVANTAGE_PRICE_SCALE };

type AdvantageColumn = ColumnKey<typeof trendyolAdvantageTariffLayout>;
type AdvantageReader = RowReader<typeof trendyolAdvantageTariffLayout>;

/** The columns of one star tier; tier 3 ("and below") has no lower limit column. */
interface StarTierColumns {
  readonly key: StarTierKey;
  readonly upper: AdvantageColumn;
  readonly lower: AdvantageColumn | null;
}

const STAR_TIER_COLUMNS: readonly StarTierColumns[] = [
  { key: 'tier1', upper: 'tier1Upper', lower: 'tier1Lower' },
  { key: 'tier2', upper: 'tier2Upper', lower: 'tier2Lower' },
  { key: 'tier3', upper: 'tier3Upper', lower: null },
];

/**
 * The star tiers of one row, in tier order, as the import stores them: a tier without a
 * readable upper limit is skipped (the row is kept), and a lower limit that does not read
 * is left out. Each kept upper limit must be a value the export can write as the new
 * sale price (`new Decimal(upperLimit).toFixed(2)`, the pick of a selected tier); the
 * stored limit stays the file's own text.
 *
 * Throws SpreadsheetFileError MALFORMED_SHEET (reason UNWRITABLE_VALUE_REASON) for an
 * upper limit the export could not write: a negative one, or one wider than its probe.
 */
export function buildStarTiers(reader: AdvantageReader): StoredStarTier[] {
  const tiers: StoredStarTier[] = [];
  for (const { key, upper, lower } of STAR_TIER_COLUMNS) {
    const upperLimit = reader.decimal(upper);
    if (upperLimit === null) continue;
    requireWritableValue(NEW_TSF_WRITE, new Decimal(upperLimit).toFixed(ADVANTAGE_PRICE_SCALE));
    const lowerLimit = lower === null ? null : reader.decimal(lower);
    tiers.push(lowerLimit === null ? { key, upperLimit } : { key, upperLimit, lowerLimit });
  }
  return tiers;
}

export const trendyolAdvantageTariffFormat = defineFormat({
  id: SUMMARY.id,
  platform: SUMMARY.platform,
  page: SUMMARY.page,
  sheet: { by: 'name', name: TRENDYOL_SHEET_NAMES.ADVANTAGE_TARIFF },
  layout: trendyolAdvantageTariffLayout,
  keep: trendyolAdvantageTariffKeep,
  anchor: 'barcode',
  fingerprint: SUMMARY.fingerprint,
  mapRow: (reader, anchor): AdvantageTariffRow => {
    // The keep rule requires a current price; a kept row without one is our bug.
    const currentPrice = reader.decimal('currentPrice');
    if (currentPrice === null) {
      throw new WorkbookInvariantError('A kept advantage tariff row has no current price');
    }
    // The file has no stock code column: the model code is stored as both, as it always was.
    const modelCode = reader.text('modelCode');
    return {
      barcode: anchor,
      stockCode: modelCode,
      // A row keeps a readable title even when its barcode matches no product.
      productTitle: reader.text('productTitle') ?? anchor,
      category: reader.text('category'),
      brand: reader.text('brand'),
      size: reader.text('size'),
      modelCode,
      stock: reader.int('stock', 'truncate'),
      currentPrice,
      customerPrice: reader.decimal('customerPrice') ?? currentPrice,
      hasCommissionTariff: reader.flag('commissionTariffFlag', {
        yes: TARIFF_FLAG_YES_FOLDED,
        compare: 'casefold-tr',
      }),
      starTiers: buildStarTiers(reader),
      applyUntilEnd: reader.flag('applyUntilEnd', {
        yes: APPLY_UNTIL_END_YES_FOLDED,
        compare: 'casefold-tr',
      }),
      externalId: reader.text('externalId'),
      tariffGroup: reader.text('tariffGroup'),
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
  },
  // The new sale price column is what Trendyol reads; a file without it cannot be exported.
  exportRequires: [['newTsf']],
  prefilled: 'ignore',
  defaultName: TRENDYOL_DEFAULT_NAMES.ADVANTAGE_TARIFF,
  filename: { kind: 'source', fallback: { kind: 'list-name' } },
});
