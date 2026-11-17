// The flash product adapter's export half on its own: the cells each row's selection
// writes (the participation label, and the seller's own price on a custom row; literal
// money cases, every case of the legacy export-cell resolver's test), and the
// cursor-zip pairing of the stored rows with the list's items through planExport. A
// product repeats per date in the file, so a selection lands on its own row only; a
// row and an item that disagree are ROW_MISMATCH instead of a silently skipped row (the
// deliberate change of the pipeline). Also the import's count of the products with an
// unknown current commission (inspect) and the response it answers.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import { FlashOfferType } from '@pazarsync/db/enums';
import {
  columnIndex,
  readWorkbookGrid,
  resolveLayout,
  type CellValue,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { describe, expect, it, vi } from 'vitest';

import { WorkbookConflictError } from '@/lib/errors';
import type { ImportedRow, WriteContext } from '@/workbooks/adapter';
import { planExport } from '@/workbooks/export-plan';
import {
  trendyolFlashProductListFormat,
  type FlashProductListRow,
  type FlashProductListWriteKey,
} from '@/workbooks/formats/trendyol/flash-product-list.format';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  FLASH_OFFER_24H_LABEL,
  FLASH_OFFER_3H_LABEL,
} from '@/workbooks/formats/trendyol/labels';
import {
  flashProductListAdapter,
  type FlashProductExportItem,
} from '@/workbooks/verticals/flash-product-list.adapter';
import { resolveWriteColumns } from '@/workbooks/write-columns';

// The fixture header is read through the parse worker, whose cold start can pass
// vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = readFileSync(resolve(__dirname, '../../../fixtures/trendyol-flash-products.xlsx'));

const adapter = flashProductListAdapter;
const format = trendyolFlashProductListFormat;

function item(
  barcode: string,
  selectedOffer: FlashOfferType | null,
  customPrice: string | null = null,
): FlashProductExportItem {
  return {
    barcode,
    selectedOffer,
    customPrice: customPrice === null ? null : new Prisma.Decimal(customPrice),
  };
}

/** The write context of a single-file row: the item alone, empty source cells. */
function writeContext(
  exportItem: FlashProductExportItem,
): WriteContext<FlashProductExportItem, FlashProductListWriteKey> {
  return {
    window: null,
    pick: null,
    items: [{ tag: null, item: exportItem }],
    source: { text: () => null, decimal: () => null },
  };
}

describe('flash product adapter: the written participation cells', () => {
  it('writes the custom label and the custom price at two decimal places', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', null, '89.9')))).toEqual([
      { key: 'updatedPrice', value: FLASH_CUSTOM_PRICE_LABEL },
      { key: 'customFlashPrice', value: '89.90' },
    ]);
  });

  it('writes a custom price with two decimals as it is', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', null, '179.47')))).toEqual([
      { key: 'updatedPrice', value: FLASH_CUSTOM_PRICE_LABEL },
      { key: 'customFlashPrice', value: '179.47' },
    ]);
  });

  it('writes a whole custom price with two decimal places', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', null, '179')))).toEqual([
      { key: 'updatedPrice', value: FLASH_CUSTOM_PRICE_LABEL },
      { key: 'customFlashPrice', value: '179.00' },
    ]);
  });

  it('prefers the custom price when a 24-hour offer is also selected', () => {
    expect(
      adapter.resolveWriteBack(writeContext(item('BC-1', FlashOfferType.H24, '150.00'))),
    ).toEqual([
      { key: 'updatedPrice', value: FLASH_CUSTOM_PRICE_LABEL },
      { key: 'customFlashPrice', value: '150.00' },
    ]);
  });

  it('writes the 24-hour label and no custom price for a 24-hour offer', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', FlashOfferType.H24)))).toEqual([
      { key: 'updatedPrice', value: FLASH_OFFER_24H_LABEL },
    ]);
  });

  it('writes the 3-hour label and no custom price for a 3-hour offer', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', FlashOfferType.H3)))).toEqual([
      { key: 'updatedPrice', value: FLASH_OFFER_3H_LABEL },
    ]);
  });

  it('writes nothing for a row with neither an offer nor a custom price', () => {
    expect(adapter.resolveWriteBack(writeContext(item('BC-1', null)))).toEqual([]);
  });
});

/** One data row of a synthetic sheet: barcode, 24-hour price, 3-hour price (null: blank). */
type SyntheticRow = readonly [string, number | null, number | null];

/** The real header and the given rows (current price 100 each), every other cell blank. */
async function syntheticSheet(
  rows: readonly SyntheticRow[],
): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const header = (await readWorkbookGrid(FIXTURE, { sheet: format.sheet }))[0] ?? [];
  const headerLayout = resolveLayout(format.layout, [header]);
  if (headerLayout === null) throw new Error('the fixture header does not resolve');
  const col = (
    key: 'barcode' | 'currentPrice' | 'customerPrice' | 'offer24Price' | 'offer3Price',
  ): number => {
    const index = columnIndex(format.layout, headerLayout, key);
    if (index === null) throw new Error(`the ${key} column did not resolve`);
    return index;
  };
  const grid: SheetData = [
    header,
    ...rows.map(([barcode, offer24, offer3]): CellValue[] => {
      const row: CellValue[] = header.map(() => null);
      row[col('barcode')] = barcode;
      row[col('currentPrice')] = 100;
      row[col('customerPrice')] = 100;
      row[col('offer24Price')] = offer24;
      row[col('offer3Price')] = offer3;
      return row;
    }),
  ];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the synthetic sheet does not resolve');
  return { grid, layout };
}

// Five data rows: B-002 has no offer price, so the import dropped it; A-001 repeats on
// another date (row 4), as the real file repeats a product per day.
const ROWS: readonly SyntheticRow[] = [
  ['A-001', 90, null],
  ['B-002', null, null],
  ['C-003', 80, 70],
  ['A-001', 85, null],
  ['D-004', null, 60],
];

// 0-based columns of the real header.
const UPDATED_PRICE_COL = 9;
const CUSTOM_PRICE_COL = 12;
const BARCODE_COL = 1;

async function plan(items: readonly FlashProductExportItem[]) {
  const { grid, layout } = await syntheticSheet(ROWS);
  return planExport({
    format,
    grid,
    layout,
    resolved: resolveWriteColumns(format, layout),
    groups: [{ tag: null, items }],
    adapter,
  });
}

async function conflictReason(items: readonly FlashProductExportItem[]): Promise<string> {
  try {
    await plan(items);
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
  throw new Error('the export plan did not refuse the items');
}

describe('flash product adapter: pairing rows and items', () => {
  it('writes each selection into its own row; the same product on another date stays as it is', async () => {
    const result = await plan([
      item('A-001', FlashOfferType.H24),
      item('C-003', null, '75.5'),
      item('A-001', null),
      item('D-004', FlashOfferType.H3),
    ]);

    expect(result.files).toEqual([
      {
        dayCount: null,
        patches: [
          {
            excelRow: 2,
            col: UPDATED_PRICE_COL,
            value: { kind: 'text', value: FLASH_OFFER_24H_LABEL },
          },
          {
            excelRow: 4,
            col: UPDATED_PRICE_COL,
            value: { kind: 'text', value: FLASH_CUSTOM_PRICE_LABEL },
          },
          {
            excelRow: 4,
            col: CUSTOM_PRICE_COL,
            value: { kind: 'number', value: '75.50', scale: 2 },
          },
          {
            excelRow: 6,
            col: UPDATED_PRICE_COL,
            value: { kind: 'text', value: FLASH_OFFER_3H_LABEL },
          },
        ],
      },
    ]);
    expect(result.anchors).toEqual([
      { excelRow: 2, col: BARCODE_COL, expected: 'A-001' },
      { excelRow: 4, col: BARCODE_COL, expected: 'C-003' },
      { excelRow: 6, col: BARCODE_COL, expected: 'D-004' },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([UPDATED_PRICE_COL, CUSTOM_PRICE_COL]);
  });

  it('refuses fewer items than kept rows with ROW_MISMATCH', async () => {
    const reason = await conflictReason([
      item('A-001', FlashOfferType.H24),
      item('C-003', null, '75.5'),
      item('A-001', null),
    ]);

    expect(reason).toBe('ROW_MISMATCH');
  });

  it('refuses an item whose barcode is not its row with ROW_MISMATCH', async () => {
    const reason = await conflictReason([
      item('A-001', FlashOfferType.H24),
      item('X-999', null, '75.5'),
      item('A-001', null),
      item('D-004', FlashOfferType.H3),
    ]);

    expect(reason).toBe('ROW_MISMATCH');
  });
});

describe('flash product adapter: the unknown commission count (inspect) and the response', () => {
  const SCOPE = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    storeId: '22222222-2222-4222-8222-222222222222',
  };

  /** A kept offer row of `barcode` on one date with the given current commission. */
  function offerRow(
    excelRow: number,
    barcode: string,
    currentCommissionPct: string | null,
  ): ImportedRow<FlashProductListRow> {
    return {
      excelRow,
      anchor: barcode,
      data: {
        barcode,
        modelCode: null,
        productTitle: barcode,
        category: null,
        brand: null,
        stock: null,
        currentPrice: '100',
        customerPrice: '100',
        currentCommissionPct,
        hasCommissionTariff: true,
        campaignedProduct: null,
        offer24: { price: '90', startsAt: null, endsAt: null },
        offer3: null,
        externalId: null,
      },
    };
  }

  async function inspect(rows: readonly ImportedRow<FlashProductListRow>[]) {
    return adapter.inspect({
      scope: SCOPE,
      config: undefined,
      now: new Date('2026-07-01T12:00:00.000Z'),
      rows,
      firstDataRow: null,
    });
  }

  // The same product spans several date rows and counts once, like productCount; a
  // readable 0 is a real 0% and is not counted.
  it('counts distinct products with an unknown current commission', async () => {
    const meta = await inspect([
      offerRow(2, 'A-001', null),
      offerRow(3, 'B-002', '19'),
      offerRow(4, 'A-001', null),
      offerRow(5, 'C-003', '0'),
      offerRow(6, 'D-004', '19'),
      offerRow(7, 'D-004', null),
    ]);

    expect(meta).toEqual({ unknownCommissionRows: 2 });
  });

  it('counts nothing when every current commission reads', async () => {
    expect(await inspect([offerRow(2, 'A-001', '19'), offerRow(3, 'A-001', '0')])).toEqual({
      unknownCommissionRows: 0,
    });
  });

  it('answers the counts of the import per product, with the unknown commission count', () => {
    expect(
      adapter.toResponse({
        parentId: 'list-1',
        name: 'Flash 8 July',
        itemCount: 122,
        rowCount: 122,
        distinctCount: 34,
        matchedRows: 4,
        matchedDistinct: 1,
        skippedRows: 0,
        prefilledRows: 3,
        meta: { unknownCommissionRows: 2 },
      }),
    ).toEqual({
      listId: 'list-1',
      name: 'Flash 8 July',
      productCount: 34,
      itemCount: 122,
      matched: 1,
      unmatched: 33,
      skippedRows: 0,
      prefilledRows: 3,
      unknownCommissionRows: 2,
    });
  });
});
