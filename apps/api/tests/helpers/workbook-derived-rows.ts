// The derived-row cases of the six Trendyol workbook verticals. The real exports drop
// no row, so each vertical also needs rows built from its fixture's first kept row with
// some cells blanked or rewritten: they put the fallback chains of a row mapper and the
// dropping side of every keep rule under test. The cases were moved verbatim out of
// tests/unit/workbooks/trendyol-layouts.test.ts so they outlive the legacy parsers (the
// discount, campaign, flash and advantage blocks have since gained kept cases, whose
// golden the legacy parser wrote); `derivedGrid` builds the grid a format test reads
// them from.

import {
  columnIndex,
  evaluate,
  resolveLayout,
  type CellValue,
  type ColumnKey,
  type LayoutSpec,
  type RowPredicate,
  type SheetData,
} from '@pazarsync/spreadsheet';

import type { trendyolAdvantageTariffLayout } from '@/workbooks/formats/trendyol/advantage-tariff.layout';
import type { trendyolCommissionTariffLayout } from '@/workbooks/formats/trendyol/commission-tariff.layout';
import type { trendyolDiscountListLayout } from '@/workbooks/formats/trendyol/discount-list.layout';
import type { trendyolFlashProductListLayout } from '@/workbooks/formats/trendyol/flash-product-list.layout';
import type { trendyolMarketplaceCampaignListLayout } from '@/workbooks/formats/trendyol/marketplace-campaign-list.layout';
import type { trendyolPlusCommissionTariffLayout } from '@/workbooks/formats/trendyol/plus-commission-tariff.layout';
import {
  CAMPAIGN_TARIFF_FLAG_YES,
  TARIFF_FLAG_YES_FOLDED,
} from '@/workbooks/formats/trendyol/labels';

/** A data row derived from a fixture's first kept row by overwriting some of its cells. */
export interface DerivedRow<S extends LayoutSpec> {
  readonly name: string;
  readonly cells: ReadonlyArray<readonly [ColumnKey<S>, CellValue]>;
  /** Whether the import keeps the row, so a case cannot drift to the other side unnoticed. */
  readonly kept: boolean;
}

const COMMISSION_DERIVED: readonly DerivedRow<typeof trendyolCommissionTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
];

const PLUS_CANCEL_NUMBER_ONE: DerivedRow<typeof trendyolPlusCommissionTariffLayout> = {
  name: 'the number 1 in the cancel cell',
  cells: [['cancelled', 1]],
  kept: true,
};

const PLUS_CANCEL_TEXT_ZERO: DerivedRow<typeof trendyolPlusCommissionTariffLayout> = {
  name: 'the text "0" in the cancel cell',
  cells: [['cancelled', '0']],
  kept: true,
};

const PLUS_DERIVED: readonly DerivedRow<typeof trendyolPlusCommissionTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
];

const ADVANTAGE_DERIVED: readonly DerivedRow<typeof trendyolAdvantageTariffLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  // Added after the move, so the derived golden pins every mapping rule of the advantage
  // row: the star tiers (a tier without an upper limit is skipped, a lower limit that
  // does not read is left out, a row without any tier), both case-folded yes flags and
  // the column each one reads, the plain grammar of the price and limit cells (number
  // cells, dot thousands with a decimal comma, a dot-only text, a lira suffix), the
  // customer price fallback, the truncated stock, a number barcode and the title
  // fallback. The fixture row's prices and limits are decimal-comma texts.
  { name: 'tier 2 without an upper limit', cells: [['tier2Upper', null]], kept: true },
  {
    name: 'tiers 1 and 2 without a readable lower limit',
    cells: [
      ['tier1Lower', null],
      ['tier2Lower', 'none'],
    ],
    kept: true,
  },
  {
    name: 'no tier at all',
    cells: [
      ['tier1Upper', null],
      ['tier2Upper', null],
      ['tier3Upper', null],
    ],
    kept: true,
  },
  { name: 'the tariff flag VAR', cells: [['commissionTariffFlag', 'VAR']], kept: true },
  { name: 'the tariff flag Yok', cells: [['commissionTariffFlag', 'Yok']], kept: true },
  { name: 'the apply-until-end flag EVET', cells: [['applyUntilEnd', 'EVET']], kept: true },
  { name: 'the apply-until-end flag evet', cells: [['applyUntilEnd', 'evet']], kept: true },
  { name: 'a blank apply-until-end flag', cells: [['applyUntilEnd', null]], kept: true },
  {
    name: 'each yes text in the other flag',
    cells: [
      ['commissionTariffFlag', 'Evet'],
      ['applyUntilEnd', 'Var'],
    ],
    kept: true,
  },
  {
    name: 'number price and limit cells',
    cells: [
      ['currentPrice', 399.9],
      ['customerPrice', 379],
      ['tier1Upper', 350],
      ['tier1Lower', 300.5],
    ],
    kept: true,
  },
  {
    name: 'dot thousands with a decimal comma',
    cells: [
      ['currentPrice', '1.234,56'],
      ['tier1Upper', '1.199,99'],
    ],
    kept: true,
  },
  { name: 'a dot-only text limit', cells: [['tier3Upper', '1.250']], kept: true },
  { name: 'a lira-suffixed current price', cells: [['currentPrice', '360 TL']], kept: false },
  { name: 'a lira-suffixed tier limit', cells: [['tier1Upper', '292 TL']], kept: true },
  {
    name: 'a blank customer price',
    cells: [
      ['customerPrice', null],
      ['currentPrice', '399,90'],
    ],
    kept: true,
  },
  {
    name: 'a lira-suffixed customer price',
    cells: [
      ['customerPrice', '350 TL'],
      ['currentPrice', 410],
    ],
    kept: true,
  },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  { name: 'a number barcode', cells: [['barcode', 8690000000001]], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['size', null],
      ['modelCode', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
      ['commissionTariffFlag', null],
      ['externalId', null],
      ['tariffGroup', null],
    ],
    kept: true,
  },
];

const FLASH_DERIVED: readonly DerivedRow<typeof trendyolFlashProductListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  {
    name: 'neither offer price',
    cells: [
      ['offer24Price', null],
      ['offer3Price', null],
    ],
    kept: false,
  },
  {
    name: 'only a 3-hour offer price',
    cells: [
      ['offer24Price', null],
      ['offer3Price', 149.9],
    ],
    kept: true,
  },
  // Added after the move, so the derived golden pins every mapping rule of the flash
  // row: the offer each price makes and its window (text, date, unreadable), the
  // customer price and commission fallbacks, the folded tariff flag, the truncated
  // stock and the title fallback.
  {
    name: 'only a 24-hour offer price',
    cells: [
      ['offer24Price', 199.9],
      ['offer3Price', null],
    ],
    kept: true,
  },
  {
    name: 'both offers, the 3-hour window as text',
    cells: [
      ['offer3Price', 99.9],
      ['offer3Start', '08/07/2026 09:00'],
      ['offer3End', '08/07/2026 12:00'],
    ],
    kept: true,
  },
  {
    name: 'a 3-hour window without a 3-hour price',
    cells: [
      ['offer3Price', null],
      ['offer3Start', '08/07/2026 09:00'],
      ['offer3End', '08/07/2026 12:00'],
    ],
    kept: true,
  },
  {
    name: 'an unreadable window start beside a readable end',
    cells: [['offer24Start', 'not a window']],
    kept: true,
  },
  {
    name: 'date-typed window cells, the end an invalid date',
    cells: [
      ['offer24Start', new Date(Date.UTC(2026, 6, 8, 9, 0))],
      ['offer24End', new Date(Number.NaN)],
    ],
    kept: true,
  },
  { name: 'a decimal-comma text offer price', cells: [['offer24Price', '179,47']], kept: true },
  {
    name: 'a TL-suffixed text 24-hour price beside a 3-hour price',
    cells: [
      ['offer24Price', '179 TL'],
      ['offer3Price', 99.9],
    ],
    kept: true,
  },
  { name: 'a blank customer price', cells: [['customerPrice', null]], kept: true },
  { name: 'a blank current commission', cells: [['currentCommission', null]], kept: true },
  { name: 'the tariff flag VAR', cells: [['commissionTariffFlag', 'VAR']], kept: true },
  { name: 'the tariff flag Yok', cells: [['commissionTariffFlag', 'Yok']], kept: true },
  { name: 'a decimal stock number', cells: [['stock', 12.7]], kept: true },
  { name: 'a decimal stock text', cells: [['stock', '12.7']], kept: true },
  { name: 'a non-numeric stock text', cells: [['stock', 'many']], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['modelCode', null],
      ['category', null],
      ['brand', null],
      ['stock', null],
      ['commissionTariffFlag', null],
      ['campaignedProduct', null],
      ['externalId', null],
    ],
    kept: true,
  },
];

const DISCOUNT_DERIVED: readonly DerivedRow<typeof trendyolDiscountListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  // Added after the move, so the derived golden pins kept rows too: the flag compares
  // exactly (a lower-case yes is not a yes), and the title falls back to the barcode.
  { name: 'a lower-case yes flag', cells: [['included', 'evet']], kept: true },
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['externalId', null],
      ['productTitle', null],
      ['brand', null],
      ['color', null],
      ['modelCode', null],
    ],
    kept: true,
  },
];

/** Dot-thousands lira text: the currency grammar reads 1250, the plain grammar nothing. */
const CAMPAIGN_LIRA_TEXT: DerivedRow<typeof trendyolMarketplaceCampaignListLayout> = {
  name: 'dot-thousands lira text prices',
  cells: [
    ['currentPrice', '1.250 ₺'],
    ['maxPrice', '1.250 ₺'],
  ],
  kept: true,
};

const CAMPAIGN_DERIVED: readonly DerivedRow<typeof trendyolMarketplaceCampaignListLayout>[] = [
  { name: 'a blank barcode', cells: [['barcode', null]], kept: false },
  { name: 'a blank current price', cells: [['currentPrice', null]], kept: false },
  { name: 'a blank maximum price', cells: [['maxPrice', null]], kept: false },
  CAMPAIGN_LIRA_TEXT,
  {
    name: 'TL-prefixed text prices',
    cells: [
      ['currentPrice', 'TL 250'],
      ['maxPrice', 'TL 250'],
    ],
    kept: false,
  },
  // Added after the move, so the derived golden pins every mapping rule of the campaign
  // row: the title falls back to the barcode, a stock that is not a plain integer reads
  // as null, and the tariff flag compares exactly (a lower-case yes is not a yes).
  {
    name: 'a blank title and blank optional columns',
    cells: [
      ['productTitle', null],
      ['productCode', null],
      ['category', null],
      ['brand', null],
      ['color', null],
      ['size', null],
      ['stockCode', null],
      ['externalId', null],
    ],
    kept: true,
  },
  { name: 'a decimal stock text', cells: [['stock', '12.5']], kept: true },
  { name: 'a decimal stock number', cells: [['stock', 12.5]], kept: true },
  {
    name: 'a lower-case tariff flag',
    cells: [['commissionTariffFlag', TARIFF_FLAG_YES_FOLDED]],
    kept: true,
  },
  {
    name: 'a tariff flag',
    cells: [['commissionTariffFlag', CAMPAIGN_TARIFF_FLAG_YES]],
    kept: true,
  },
];

// Exported as a list: the blocks above keep the exact bytes they had in the layout test,
// apart from the cases added to the discount, campaign, flash and advantage blocks.
export {
  ADVANTAGE_DERIVED,
  CAMPAIGN_DERIVED,
  CAMPAIGN_LIRA_TEXT,
  COMMISSION_DERIVED,
  DISCOUNT_DERIVED,
  FLASH_DERIVED,
  PLUS_CANCEL_NUMBER_ONE,
  PLUS_CANCEL_TEXT_ZERO,
  PLUS_DERIVED,
};

/**
 * `fixtureGrid` plus one row per case: each a copy of the fixture's first data row that
 * passes `keep`, with the case's cells written over it. The keep rule chooses the row,
 * not a legacy parser, so the helper outlives the legacy code.
 */
export function derivedGrid<S extends LayoutSpec>(
  spec: S,
  keep: RowPredicate<ColumnKey<S>>,
  fixtureGrid: SheetData,
  cases: readonly DerivedRow<S>[],
): SheetData {
  const layout = resolveLayout(spec, fixtureGrid);
  if (layout === null) throw new Error('The fixture layout did not resolve');
  const first = fixtureGrid
    .slice(layout.headerRowIndex + 1)
    .find((row) => evaluate(keep, row, spec, layout));
  if (first === undefined) throw new Error('The fixture has no kept row');
  const derived = cases.map((testCase): CellValue[] => {
    const row = [...first];
    for (const [key, value] of testCase.cells) {
      const col = columnIndex(spec, layout, key);
      if (col === null) throw new Error(`Derived column "${key}" did not resolve`);
      row[col] = value;
    }
    return row;
  });
  return [...fixtureGrid, ...derived];
}
