import { describe, expect, it } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import {
  all,
  block,
  defineLayout,
  has,
  header,
  resolveLayout,
  type CellValue,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { WorkbookConflictError, type WorkbookConflictReason } from '@/lib/errors';
import type {
  CellWrite,
  ExportGroup,
  WorkbookExportAdapter,
  WriteContext,
} from '@/workbooks/adapter';
import { planExport, type ExportPlan } from '@/workbooks/export-plan';
import { defineFormat, type WorkbookFormat } from '@/workbooks/format';
import { TARIFF_WINDOW_LABEL_UNIT } from '@/workbooks/formats/trendyol/labels';
import { WorkbookInvariantError } from '@/workbooks/workbook-errors';
import { resolveWriteColumns } from '@/workbooks/write-columns';

// A synthetic sheet: a barcode and a price (the keep rule), two plain write columns
// (a flag with an allow list and an amount with two decimals) and a repeated period
// block whose offer column is found by a header carrying the block's tag.

const U_UML = String.fromCodePoint(0xfc);
// Trendyol's window unit, spelled here without the labels module.
const WINDOW_UNIT = `G${U_UML}nl${U_UML}k Fiyat`;

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode'), price: header('Price') },
  optional: { flag: header('Flag'), amount: header('Amount') },
  blocks: {
    period: block({
      anchor: /^Period (\d+)$/,
      follow: [],
      columns: {},
      lookups: { offer: { template: 'Offer {tag}' } },
      min: 0,
    }),
  },
});

type WriteKey = 'flag' | 'amount' | 'offer';

const FORMAT = defineFormat({
  id: 'TRENDYOL:PLUS_COMMISSION_TARIFF:v1',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  sheet: { by: 'index', index: 0 },
  layout,
  keep: all(has('barcode', 'text'), has('price', 'decimal')),
  anchor: 'barcode',
  fingerprint: ['Barcode', 'Price', 'Flag'],
  mapRow: (_reader, anchor) => ({ anchor }),
  writeBack: {
    flag: {
      target: { kind: 'column', key: 'flag' },
      value: { kind: 'text', allow: ['No', 'Yes'] },
      overwritesFormula: false,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    amount: {
      target: { kind: 'column', key: 'amount' },
      value: { kind: 'number', scale: 2 },
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    offer: {
      target: { kind: 'blockLookup', block: 'period', lookup: 'offer' },
      value: { kind: 'number', scale: 2 },
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['flag', 'amount', 'offer']],
  prefilled: 'ignore',
  defaultName: 'Synthetic list',
  filename: {
    kind: 'window',
    base: 'synthetic',
    labelUnit: TARIFF_WINDOW_LABEL_UNIT,
    fileUnit: 'gunluk',
  },
});

// The same format, except that an unselected item clears its flag cell.
const CLEARING_FORMAT = defineFormat({
  ...FORMAT,
  writeBack: {
    ...FORMAT.writeBack,
    flag: { ...FORMAT.writeBack.flag, clearWhenUnselected: true },
  },
});

type Format = WorkbookFormat<typeof layout, { anchor: string }, WriteKey>;

interface Item {
  readonly id: string;
  readonly barcode: string;
  /** What the item carries: its pick in anchor-map, its flag in cursor-zip. */
  readonly value: string | null;
}

type Writer = (ctx: WriteContext<Item, WriteKey>) => readonly CellWrite<WriteKey>[];

type PlanAdapter = Pick<
  WorkbookExportAdapter<typeof layout, { anchor: string }, Item, WriteKey>,
  'align' | 'files' | 'anchorOf' | 'pick' | 'resolveWriteBack'
>;

/** An adapter that records every write context it is asked about. */
function adapterOf(
  align: PlanAdapter['align'],
  files: PlanAdapter['files'],
  write: Writer,
): { readonly adapter: PlanAdapter; readonly contexts: WriteContext<Item, WriteKey>[] } {
  const contexts: WriteContext<Item, WriteKey>[] = [];
  return {
    contexts,
    adapter: {
      align,
      files,
      anchorOf: (item) => item.barcode,
      pick: (item) => (align === 'cursor-zip' ? null : item.value),
      resolveWriteBack: (ctx) => {
        contexts.push(ctx);
        return write(ctx);
      },
    },
  };
}

function plan(
  grid: SheetData,
  groups: readonly ExportGroup<Item>[],
  adapter: PlanAdapter,
  format: Format = FORMAT,
): ExportPlan {
  const resolvedLayout = resolveLayout(format.layout, grid);
  if (resolvedLayout === null) throw new Error('synthetic layout did not resolve');
  const resolved = resolveWriteColumns(format, resolvedLayout);
  return planExport({ format, grid, layout: resolvedLayout, resolved, groups, adapter });
}

function conflictReason(run: () => unknown): WorkbookConflictReason | null {
  try {
    run();
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
  return null;
}

function item(id: string, barcode: string, value: string | null): Item {
  return { id, barcode, value };
}

function single(items: readonly Item[]): readonly ExportGroup<Item>[] {
  return [{ tag: null, items }];
}

const HEADER: readonly CellValue[] = ['Barcode', 'Price', 'Flag', 'Amount'];
// Columns 4 to 7: two period blocks, tags 3 and 4.
const BLOCK_HEADER: readonly CellValue[] = [
  ...HEADER,
  'Period 3',
  'Offer 3',
  'Period 4',
  'Offer 4',
];

const FLAG_COL = 2;
const AMOUNT_COL = 3;
const OFFER_3_COL = 5;
const OFFER_4_COL = 7;

/** Writes the item's flag (cursor-zip) or its pick into the amount column (anchor-map). */
const writeFlag: Writer = (ctx) => {
  const value = ctx.items[0]?.item.value ?? null;
  return value === null ? [] : [{ key: 'flag', value }];
};
const writePickAmount: Writer = (ctx) => [{ key: 'amount', value: ctx.pick }];

describe('planExport, cursor-zip', () => {
  it('pairs kept rows with items in order and patches the rows that change', () => {
    const grid: SheetData = [[...HEADER], ['B-1', 10, 'No'], ['B-2', 20, 'No'], ['B-3', 30, 'No']];
    const { adapter, contexts } = adapterOf('cursor-zip', 'single', writeFlag);

    const result = plan(
      grid,
      single([item('i1', 'B-1', 'Yes'), item('i2', 'B-2', null), item('i3', 'B-3', 'Yes')]),
      adapter,
    );

    expect(result.files).toEqual([
      {
        dayCount: null,
        patches: [
          { excelRow: 2, col: FLAG_COL, value: { kind: 'text', value: 'Yes' } },
          { excelRow: 4, col: FLAG_COL, value: { kind: 'text', value: 'Yes' } },
        ],
      },
    ]);
    expect(result.anchors).toEqual([
      { excelRow: 2, col: 0, expected: 'B-1' },
      { excelRow: 4, col: 0, expected: 'B-3' },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([AMOUNT_COL]);
    expect(contexts).toHaveLength(3);
    expect(contexts[0]?.window).toBeNull();
    expect(contexts[0]?.pick).toBeNull();
    expect(contexts[0]?.items).toEqual([{ tag: null, item: item('i1', 'B-1', 'Yes') }]);
    expect(contexts[0]?.source.text('flag')).toBe('No');
  });

  it('keeps the pairing across a skipped row in the middle', () => {
    const grid: SheetData = [
      [...HEADER],
      ['B-1', 10, 'No'],
      // No price: the keep rule drops it, so it takes no item.
      ['B-X', null, 'No'],
      ['B-2', 20, 'No'],
      ['B-3', 30, 'No'],
    ];
    const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);

    const result = plan(
      grid,
      single([item('i1', 'B-1', null), item('i2', 'B-2', 'Yes'), item('i3', 'B-3', null)]),
      adapter,
    );

    expect(result.files[0]?.patches).toEqual([
      { excelRow: 4, col: FLAG_COL, value: { kind: 'text', value: 'Yes' } },
    ]);
    expect(result.anchors).toEqual([{ excelRow: 4, col: 0, expected: 'B-2' }]);
  });

  it('refuses two items for three kept rows with ROW_MISMATCH', () => {
    const grid: SheetData = [[...HEADER], ['B-1', 10], ['B-2', 20], ['B-3', 30]];
    const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);

    expect(
      conflictReason(() =>
        plan(grid, single([item('i1', 'B-1', 'Yes'), item('i2', 'B-2', 'Yes')]), adapter),
      ),
    ).toBe('ROW_MISMATCH');
  });

  it('refuses a different barcode at position 2 with ROW_MISMATCH', () => {
    const grid: SheetData = [[...HEADER], ['B-1', 10], ['B-2', 20], ['B-3', 30]];
    const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);

    expect(
      conflictReason(() =>
        plan(
          grid,
          single([item('i1', 'B-1', 'Yes'), item('i2', 'B-9', 'Yes'), item('i3', 'B-3', 'Yes')]),
          adapter,
        ),
      ),
    ).toBe('ROW_MISMATCH');
  });
});

describe('planExport, anchor-map', () => {
  // Rows 3 and 7 carry B-2; row 7 has no price, so the keep rule drops it, and the
  // export still patches it.
  const REPEATED: SheetData = [
    [...HEADER],
    ['B-1', 10],
    ['B-2', 20],
    ['B-3', 30],
    ['B-4', 40],
    ['B-5', 50],
    ['B-2', null],
  ];

  it('patches every row that carries the barcode', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'single', writePickAmount);

    const result = plan(REPEATED, single([item('i2', 'B-2', '12.50')]), adapter);

    expect(result.files).toEqual([
      {
        dayCount: null,
        patches: [
          { excelRow: 3, col: AMOUNT_COL, value: { kind: 'number', value: '12.50', scale: 2 } },
          { excelRow: 7, col: AMOUNT_COL, value: { kind: 'number', value: '12.50', scale: 2 } },
        ],
      },
    ]);
    expect(result.anchors).toEqual([
      { excelRow: 3, col: 0, expected: 'B-2' },
      { excelRow: 7, col: 0, expected: 'B-2' },
    ]);
    expect(contexts[0]?.pick).toBe('12.50');
    expect(contexts[0]?.window).toBeNull();
  });

  it('writes the later of two picked items with the same barcode on every row', () => {
    const { adapter } = adapterOf('anchor-map', 'single', writePickAmount);

    const result = plan(
      REPEATED,
      single([item('first', 'B-2', '12.50'), item('second', 'B-2', '15.00')]),
      adapter,
    );

    expect(result.files[0]?.patches.map((patch) => [patch.excelRow, patch.value])).toEqual([
      [3, { kind: 'number', value: '15.00', scale: 2 }],
      [7, { kind: 'number', value: '15.00', scale: 2 }],
    ]);
  });

  it('keeps a picked item when an unpicked duplicate follows it', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'single', writePickAmount);

    const result = plan(
      REPEATED,
      single([item('picked', 'B-2', '12.50'), item('unpicked', 'B-2', null)]),
      adapter,
    );

    expect(result.files[0]?.patches.map((patch) => patch.value)).toEqual([
      { kind: 'number', value: '12.50', scale: 2 },
      { kind: 'number', value: '12.50', scale: 2 },
    ]);
    expect(contexts.map((ctx) => ctx.items)).toEqual([
      [{ tag: null, item: item('picked', 'B-2', '12.50') }],
      [{ tag: null, item: item('picked', 'B-2', '12.50') }],
    ]);
  });

  it('writes nothing for a barcode whose only item has no pick', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'single', writePickAmount);

    const result = plan(REPEATED, single([item('i2', 'B-2', null)]), adapter);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
    expect(contexts).toEqual([]);
  });
});

describe('planExport, period-windows', () => {
  const GRID: SheetData = [[...BLOCK_HEADER], ['B-1', 10], ['B-2', 20]];

  function groups(three: readonly Item[], four: readonly Item[]): readonly ExportGroup<Item>[] {
    return [
      { tag: 3, items: three },
      { tag: 4, items: four },
    ];
  }

  it('puts a barcode picked alike in both periods into one whole-week file', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'period-windows', writePickAmount);

    const result = plan(
      GRID,
      groups([item('a3', 'B-1', '10.00')], [item('a4', 'B-1', '10.00')]),
      adapter,
    );

    expect(result.files).toEqual([
      {
        dayCount: 7,
        patches: [
          { excelRow: 2, col: AMOUNT_COL, value: { kind: 'number', value: '10.00', scale: 2 } },
        ],
      },
    ]);
    expect(contexts[0]?.window).toEqual({ dayCount: 7, label: `7 ${WINDOW_UNIT}` });
    expect(contexts[0]?.items).toEqual([
      { tag: 3, item: item('a3', 'B-1', '10.00') },
      { tag: 4, item: item('a4', 'B-1', '10.00') },
    ]);
  });

  it('puts different picks into the two period files, 3 then 4', () => {
    const { adapter } = adapterOf('anchor-map', 'period-windows', writePickAmount);

    const result = plan(
      GRID,
      groups([item('a3', 'B-1', '10.00')], [item('a4', 'B-1', '11.00')]),
      adapter,
    );

    expect(result.files).toEqual([
      {
        dayCount: 3,
        patches: [
          { excelRow: 2, col: AMOUNT_COL, value: { kind: 'number', value: '10.00', scale: 2 } },
        ],
      },
      {
        dayCount: 4,
        patches: [
          { excelRow: 2, col: AMOUNT_COL, value: { kind: 'number', value: '11.00', scale: 2 } },
        ],
      },
    ]);
    expect(result.anchors).toEqual([{ excelRow: 2, col: 0, expected: 'B-1' }]);
  });

  it('writes a pick of one period into that period file only, labelled with its days', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'period-windows', writePickAmount);

    const result = plan(GRID, groups([item('a3', 'B-2', '20.00')], []), adapter);

    expect(result.files.map((file) => file.dayCount)).toEqual([3]);
    expect(result.files[0]?.patches).toEqual([
      { excelRow: 3, col: AMOUNT_COL, value: { kind: 'number', value: '20.00', scale: 2 } },
    ]);
    expect(contexts[0]?.window).toEqual({ dayCount: 3, label: `3 ${WINDOW_UNIT}` });
    expect(contexts[0]?.pick).toBe('20.00');
  });

  it('writes a duplicate picked in the second group only into that group file', () => {
    const { adapter, contexts } = adapterOf('anchor-map', 'period-windows', writePickAmount);

    const result = plan(
      GRID,
      groups(
        [item('a3', 'B-2', null)],
        [item('picked', 'B-2', '20.00'), item('unpicked', 'B-2', null)],
      ),
      adapter,
    );

    expect(result.files.map((file) => file.dayCount)).toEqual([4]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.items).toEqual([{ tag: 4, item: item('picked', 'B-2', '20.00') }]);
  });

  it('answers one empty file without a day count when nothing is picked', () => {
    const { adapter } = adapterOf('anchor-map', 'period-windows', writePickAmount);

    const result = plan(GRID, groups([item('a3', 'B-1', null)], []), adapter);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
  });
});

describe('planExport, from writes to patches', () => {
  const ONE_ROW: SheetData = [[...BLOCK_HEADER], ['B-1', 10, 'Yes', 15.4]];

  function writesOf(writes: readonly CellWrite<WriteKey>[], format: Format = FORMAT): ExportPlan {
    const { adapter } = adapterOf('cursor-zip', 'single', () => writes);
    return plan(ONE_ROW, single([item('i1', 'B-1', null)]), adapter, format);
  }

  it('drops a write to a column the file does not have', () => {
    // No Amount column: only Barcode, Price and Flag.
    const grid: SheetData = [
      ['Barcode', 'Price', 'Flag'],
      ['B-1', 10, 'No'],
    ];
    const { adapter } = adapterOf('cursor-zip', 'single', () => [{ key: 'amount', value: '1.00' }]);

    const result = plan(grid, single([item('i1', 'B-1', null)]), adapter);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
  });

  it('writes nothing for a null value unless the column clears when unselected', () => {
    expect(writesOf([{ key: 'flag', value: null }]).files[0]?.patches).toEqual([]);
    expect(writesOf([{ key: 'flag', value: null }], CLEARING_FORMAT).files[0]?.patches).toEqual([
      { excelRow: 2, col: FLAG_COL, value: { kind: 'clear' } },
    ]);
  });

  it('does not clear a cell that is already blank, so the row needs no anchor', () => {
    for (const blank of [null, '', '  ']) {
      const grid: SheetData = [[...BLOCK_HEADER], ['B-1', 10, blank, 15.4]];
      const { adapter } = adapterOf('cursor-zip', 'single', () => [{ key: 'flag', value: null }]);

      const result = plan(grid, single([item('i1', 'B-1', null)]), adapter, CLEARING_FORMAT);

      expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
      expect(result.anchors).toEqual([]);
    }
  });

  it('drops a value equal to the source cell, as text and as a number', () => {
    expect(writesOf([{ key: 'flag', value: 'Yes' }]).files[0]?.patches).toEqual([]);
    // The source amount is the number 15.4; '15.40' is the same amount.
    expect(writesOf([{ key: 'amount', value: '15.40' }]).files[0]?.patches).toEqual([]);
    expect(writesOf([{ key: 'amount', value: '15.41' }]).files[0]?.patches).toEqual([
      { excelRow: 2, col: AMOUNT_COL, value: { kind: 'number', value: '15.41', scale: 2 } },
    ]);
  });

  it('throws WorkbookInvariantError for a value its column may not receive', () => {
    expect(() => writesOf([{ key: 'flag', value: 'Maybe' }])).toThrow(WorkbookInvariantError);
    expect(() => writesOf([{ key: 'amount', value: '15.4' }])).toThrow(WorkbookInvariantError);
  });

  it("lands a block write in its tag's column and drops it when no block has the tag", () => {
    expect(writesOf([{ key: 'offer', tag: 4, value: '9.99' }]).files[0]?.patches).toEqual([
      { excelRow: 2, col: OFFER_4_COL, value: { kind: 'number', value: '9.99', scale: 2 } },
    ]);
    expect(writesOf([{ key: 'offer', tag: 3, value: '9.99' }]).files[0]?.patches).toEqual([
      { excelRow: 2, col: OFFER_3_COL, value: { kind: 'number', value: '9.99', scale: 2 } },
    ]);
    expect(writesOf([{ key: 'offer', tag: 5, value: '9.99' }]).files[0]?.patches).toEqual([]);
  });

  it("refuses an anchor longer than Excel's cell limit with STORED_FILE_UNREADABLE", () => {
    // 32 767 UTF-16 code units is Excel's cell limit and the patcher's anchor limit.
    const atLimit = 'B'.repeat(32_767);
    const overLimit = 'B'.repeat(32_768);
    const anchored = (barcode: string): ExportPlan => {
      const grid: SheetData = [[...HEADER], [barcode, 10, 'No']];
      const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);
      return plan(grid, single([item('i1', barcode, 'Yes')]), adapter);
    };

    expect(anchored(atLimit).anchors).toEqual([{ excelRow: 2, col: 0, expected: atLimit }]);
    expect(conflictReason(() => anchored(overLimit))).toBe('STORED_FILE_UNREADABLE');
  });

  it('refuses anchors above the patch request text budget with STORED_FILE_UNREADABLE', () => {
    // 520 anchors of 32 300 units: about 16.8 million, above the 16 MiB budget
    // (16 777 216), each one under the per-anchor limit.
    const rowCount = 520;
    const barcodes = Array.from({ length: rowCount }, (_, i) =>
      String(i).padStart(3, '0').padEnd(32_300, 'B'),
    );
    const grid: SheetData = [[...HEADER], ...barcodes.map((barcode) => [barcode, 10, 'No'])];
    const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);
    const items = barcodes.map((barcode, i) => item(`i${i}`, barcode, 'Yes'));

    expect(conflictReason(() => plan(grid, single(items), adapter))).toBe('STORED_FILE_UNREADABLE');
    // One row fewer than needed stays under the budget: 519 x 32 300 = 16 763 700,
    // plus 519 three-unit values.
    const fewer = plan(grid.slice(0, rowCount), single(items.slice(0, rowCount - 1)), adapter);
    expect(fewer.anchors).toHaveLength(rowCount - 1);
  });

  it('refuses a file without any required write column with NO_WRITEBACK_COLUMN', () => {
    const grid: SheetData = [
      ['Barcode', 'Price'],
      ['B-1', 10],
    ];
    const { adapter } = adapterOf('cursor-zip', 'single', writeFlag);

    expect(conflictReason(() => plan(grid, single([item('i1', 'B-1', 'Yes')]), adapter))).toBe(
      'NO_WRITEBACK_COLUMN',
    );
  });
});
