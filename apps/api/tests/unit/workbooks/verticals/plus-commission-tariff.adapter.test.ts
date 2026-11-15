// The Plus commission tariff adapter on its own: the Plus price each item carries (its
// pick, literal money cases), what a covered row writes (the price, the window's tariff
// selection, one computed commission per covered period, the no-cancel label), how the
// window files and the anchor map pick among periods and repeated barcodes, the week
// check of the upload (the database mocked; the persist re-check runs against the real
// database in plus-commission-tariffs-duplicate-week.routes.test.ts), and the form,
// name and response.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import {
  columnIndex,
  createRowReader,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellPatch,
  type CellValue,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { businessZoneEpochToInstant } from '@pazarsync/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExportGroup, WriteContext } from '@/workbooks/adapter';
import { planExport } from '@/workbooks/export-plan';
import { NO_LABEL, TARIFF_WINDOW_LABEL_UNIT } from '@/workbooks/formats/trendyol/labels';
import {
  trendyolPlusCommissionTariffFormat,
  type PlusCommissionTariffWriteKey,
} from '@/workbooks/formats/trendyol/plus-commission-tariff.format';
import type { TariffWeek } from '@/workbooks/tariff-week';
import {
  plusCommissionTariffAdapter,
  resolvePlusExportPrice,
  type PlusCommissionTariffExportItem,
} from '@/workbooks/verticals/plus-commission-tariff.adapter';
import { WorkbookFileRejection, WorkbookInvariantError } from '@/workbooks/workbook-errors';
import { resolveWriteColumns, UNWRITABLE_VALUE_REASON } from '@/workbooks/write-columns';

const mocks = vi.hoisted(() => ({ findPlusTariff: vi.fn() }));

// Only the week overlap query of `inspect` reaches the database in this file.
vi.mock('@pazarsync/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pazarsync/db')>()),
  prisma: { plusCommissionTariff: { findFirst: mocks.findPlusTariff } },
}));

// The fixture headers are read through the parse worker, whose cold start can pass
// vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const FIXTURES_DIR = resolve(__dirname, '../../../fixtures');
const SINGLE = readFileSync(resolve(FIXTURES_DIR, 'trendyol-plus-tariff.xlsx'));
const MULTI = readFileSync(resolve(FIXTURES_DIR, 'trendyol-plus-tariff-3ve4.xlsx'));
const READER_OPTIONS = { toInstant: businessZoneEpochToInstant };

const adapter = plusCommissionTariffAdapter;
const format = trendyolPlusCommissionTariffFormat;

const SCOPE = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
};

/** The tariff selection of a window of `days` days. */
function windowLabel(days: number): string {
  return `${days} ${TARIFF_WINDOW_LABEL_UNIT}`;
}

function item(
  barcode: string,
  plusSelected: boolean,
  customPrice: string | null,
  plusPriceUpperLimit = '120',
  plusCommissionPct = '12.5',
): PlusCommissionTariffExportItem {
  return {
    barcode,
    plusSelected,
    customPrice: customPrice === null ? null : new Prisma.Decimal(customPrice),
    plusPriceUpperLimit: new Prisma.Decimal(plusPriceUpperLimit),
    plusCommissionPct: new Prisma.Decimal(plusCommissionPct),
  };
}

afterEach(() => {
  mocks.findPlusTariff.mockReset();
});

describe('Plus commission tariff adapter: the Plus price an item carries (pick)', () => {
  it('is the custom price of a selected item, at two decimal places', () => {
    expect(resolvePlusExportPrice(item('BC-1', true, '99.9'))).toBe('99.90');
    expect(adapter.pick(item('BC-1', true, '99.9'))).toBe('99.90');
  });

  it('is the Plus price ceiling of a selected item without a custom price', () => {
    expect(resolvePlusExportPrice(item('BC-1', true, null, '120'))).toBe('120.00');
    expect(resolvePlusExportPrice(item('BC-1', true, null, '740.77'))).toBe('740.77');
  });

  it('is null for an item that is not selected, even with a custom price', () => {
    expect(resolvePlusExportPrice(item('BC-1', false, null))).toBeNull();
    expect(resolvePlusExportPrice(item('BC-1', false, '99.9'))).toBeNull();
  });
});

describe('Plus commission tariff adapter: what a covered row writes', () => {
  function writeContext(
    pick: string | null,
    items: WriteContext<PlusCommissionTariffExportItem, PlusCommissionTariffWriteKey>['items'],
    window: WriteContext<PlusCommissionTariffExportItem, PlusCommissionTariffWriteKey>['window'] = {
      dayCount: 7,
      label: windowLabel(7),
    },
  ): WriteContext<PlusCommissionTariffExportItem, PlusCommissionTariffWriteKey> {
    return { window, pick, items, source: { text: () => null, decimal: () => null } };
  }

  it("writes the pick, the window's selection, the period's commission and the no-cancel label", () => {
    const writes = adapter.resolveWriteBack(
      writeContext('120.00', [{ tag: 7, item: item('BC-1', true, null, '120', '12.50') }]),
    );

    expect(writes).toEqual([
      { key: 'plusPriceSelection', value: '120.00' },
      { key: 'tariffSelection', value: windowLabel(7) },
      { key: 'computedCommission', tag: 7, value: '12.5' },
      { key: 'cancelled', value: NO_LABEL },
    ]);
  });

  it('writes the commission as stored, in plain notation, never in exponent form', () => {
    const writes = adapter.resolveWriteBack(
      writeContext('120.00', [{ tag: 7, item: item('BC-1', true, null, '120', '0.000001') }]),
    );

    expect(writes).toContainEqual({ key: 'computedCommission', tag: 7, value: '0.000001' });
  });

  it('writes one commission per covered period, each at its own percent', () => {
    const writes = adapter.resolveWriteBack(
      writeContext('740.77', [
        { tag: 3, item: item('BC-1', true, null, '740.77', '10.7') },
        { tag: 4, item: item('BC-1', true, null, '740.77', '13.1') },
      ]),
    );

    expect(writes.filter((write) => write.key === 'computedCommission')).toEqual([
      { key: 'computedCommission', tag: 3, value: '10.7' },
      { key: 'computedCommission', tag: 4, value: '13.1' },
    ]);
  });

  it('writes no commission for a period without a day count', () => {
    const writes = adapter.resolveWriteBack(
      writeContext('120.00', [{ tag: null, item: item('BC-1', true, null) }]),
    );

    expect(writes.map((write) => write.key)).toEqual([
      'plusPriceSelection',
      'tariffSelection',
      'cancelled',
    ]);
  });

  it('writes nothing without a pick', () => {
    expect(adapter.resolveWriteBack(writeContext(null, []))).toEqual([]);
  });

  it('refuses a row without a window: the Plus export always writes into a period window', () => {
    expect(() =>
      adapter.resolveWriteBack(
        writeContext('120.00', [{ tag: 7, item: item('BC-1', true, null) }], null),
      ),
    ).toThrow(WorkbookInvariantError);
  });
});

/** The real header of `file` and one data row per barcode, every other cell blank. */
async function syntheticSheet(
  file: Buffer,
  barcodes: readonly string[],
): Promise<{ grid: SheetData; layout: ResolvedLayout }> {
  const header = (await readWorkbookGrid(file, { sheet: format.sheet }))[0] ?? [];
  const headerLayout = resolveLayout(format.layout, [header]);
  if (headerLayout === null) throw new Error('the fixture header does not resolve');
  const barcodeCol = columnIndex(format.layout, headerLayout, 'barcode');
  if (barcodeCol === null) throw new Error('the barcode column did not resolve');
  const grid: SheetData = [
    header,
    ...barcodes.map((barcode): CellValue[] => {
      const row: CellValue[] = header.map(() => null);
      row[barcodeCol] = barcode;
      return row;
    }),
  ];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the synthetic sheet does not resolve');
  return { grid, layout };
}

async function plan(
  file: Buffer,
  barcodes: readonly string[],
  groups: readonly ExportGroup<PlusCommissionTariffExportItem>[],
) {
  const { grid, layout } = await syntheticSheet(file, barcodes);
  return planExport({
    format,
    grid,
    layout,
    resolved: resolveWriteColumns(format, layout),
    groups,
    adapter,
  });
}

// The write columns of the single-period file (P, Q, S, T: price, selection, the 7-day
// computed commission, cancel) and of the split-week file (S, T, V, W, X: price,
// selection, the 3-day and 4-day computed commissions, cancel).
const SINGLE_COLS = { price: 16, selection: 17, commission7: 18, cancelled: 19 } as const;
const MULTI_COLS = {
  price: 18,
  selection: 19,
  commission3: 21,
  commission4: 22,
  cancelled: 23,
} as const;

function price(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'number', value, scale: 2 } };
}

function text(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'text', value } };
}

function percent(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'number', value } };
}

describe('Plus commission tariff adapter: the window files', () => {
  it('writes a whole-week file with one price and a commission cell per covered period', async () => {
    const result = await plan(
      MULTI,
      ['A-001'],
      [
        { tag: 3, items: [item('A-001', true, null, '740.77', '10.7')] },
        { tag: 4, items: [item('A-001', true, null, '740.77', '13.1')] },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 7,
        patches: [
          price(2, MULTI_COLS.price, '740.77'),
          text(2, MULTI_COLS.selection, windowLabel(7)),
          percent(2, MULTI_COLS.commission3, '10.7'),
          percent(2, MULTI_COLS.commission4, '13.1'),
          text(2, MULTI_COLS.cancelled, NO_LABEL),
        ],
      },
    ]);
    expect(result.overwriteFormulaColumns).toEqual([18, 19, 21, 22, 23]);
  });

  it('writes one file per period for different prices, each with its own commission', async () => {
    const result = await plan(
      MULTI,
      ['A-001'],
      [
        { tag: 3, items: [item('A-001', true, '700', '740.77', '10.7')] },
        { tag: 4, items: [item('A-001', true, '650', '740.77', '13.1')] },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 3,
        patches: [
          price(2, MULTI_COLS.price, '700.00'),
          text(2, MULTI_COLS.selection, windowLabel(3)),
          percent(2, MULTI_COLS.commission3, '10.7'),
          text(2, MULTI_COLS.cancelled, NO_LABEL),
        ],
      },
      {
        dayCount: 4,
        patches: [
          price(2, MULTI_COLS.price, '650.00'),
          text(2, MULTI_COLS.selection, windowLabel(4)),
          percent(2, MULTI_COLS.commission4, '13.1'),
          text(2, MULTI_COLS.cancelled, NO_LABEL),
        ],
      },
    ]);
  });

  it("writes into the tag-4 block's column when the file's first period was dropped at import", async () => {
    // The stored tariff holds only the 4-day period (its 3-day label was blank on the
    // first row); the file still has both blocks.
    const result = await plan(
      MULTI,
      ['A-001'],
      [{ tag: 4, items: [item('A-001', true, null, '740.77', '13.1')] }],
    );

    expect(result.files).toEqual([
      {
        dayCount: 4,
        patches: [
          price(2, MULTI_COLS.price, '740.77'),
          text(2, MULTI_COLS.selection, windowLabel(4)),
          percent(2, MULTI_COLS.commission4, '13.1'),
          text(2, MULTI_COLS.cancelled, NO_LABEL),
        ],
      },
    ]);
  });

  it('writes one empty file without a day count when nothing is selected', async () => {
    const result = await plan(SINGLE, ['A-001'], [{ tag: 7, items: [item('A-001', false, null)] }]);

    expect(result.files).toEqual([{ dayCount: null, patches: [] }]);
    expect(result.anchors).toEqual([]);
  });
});

describe('Plus commission tariff adapter: a barcode on several rows', () => {
  it("writes the selected item's price and commission on every row of its barcode", async () => {
    // Rows 2 and 4 carry A-001; the first item is selected, the later one is not.
    const result = await plan(
      SINGLE,
      ['A-001', 'B-002', 'A-001'],
      [
        {
          tag: 7,
          items: [
            item('A-001', true, null, '120', '10.5'),
            item('B-002', false, null),
            item('A-001', false, '99', '150', '9'),
          ],
        },
      ],
    );

    expect(result.files).toEqual([
      {
        dayCount: 7,
        patches: [
          price(2, SINGLE_COLS.price, '120.00'),
          text(2, SINGLE_COLS.selection, windowLabel(7)),
          percent(2, SINGLE_COLS.commission7, '10.5'),
          text(2, SINGLE_COLS.cancelled, NO_LABEL),
          price(4, SINGLE_COLS.price, '120.00'),
          text(4, SINGLE_COLS.selection, windowLabel(7)),
          percent(4, SINGLE_COLS.commission7, '10.5'),
          text(4, SINGLE_COLS.cancelled, NO_LABEL),
        ],
      },
    ]);
    expect(result.anchors.map((anchor) => [anchor.excelRow, anchor.expected])).toEqual([
      [2, 'A-001'],
      [4, 'A-001'],
    ]);
  });

  it('writes the later of two selected items of one barcode', async () => {
    const result = await plan(
      SINGLE,
      ['A-001'],
      [
        {
          tag: 7,
          items: [
            item('A-001', true, '100', '120', '10.5'),
            item('A-001', true, '110', '120', '9'),
          ],
        },
      ],
    );

    expect(result.files[0]?.patches).toContainEqual(price(2, SINGLE_COLS.price, '110.00'));
    expect(result.files[0]?.patches).toContainEqual(percent(2, SINGLE_COLS.commission7, '9'));
  });
});

/** A reader over the first data row of the single-period file. */
async function firstDataRowOf(file: Buffer) {
  const grid = await readWorkbookGrid(file, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the fixture does not resolve');
  return createRowReader(format.layout, layout, grid[1] ?? [], READER_OPTIONS);
}

/**
 * A reader over the first data row of `file` once its period label and computed
 * commission headers of `from` days say `to` days instead; the decoy headers that only
 * mention a day count are left as they are.
 */
async function firstDataRowWithDays(file: Buffer, from: number, to: number) {
  const [header = [], ...rows] = await readWorkbookGrid(file, { sheet: format.sheet });
  const rewritten = header.map((cell) =>
    typeof cell === 'string' && /^(?:Tarih|Hesaplanan) /.test(cell)
      ? cell.replace(`(${from} `, `(${to} `)
      : cell,
  );
  const grid: SheetData = [rewritten, ...rows];
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new Error('the rewritten header does not resolve');
  return createRowReader(format.layout, layout, grid[1] ?? [], READER_OPTIONS);
}

describe('Plus commission tariff adapter: the week of the upload (inspect)', () => {
  // The single-period file's one period: 30 Haziran 08.00-7 Temmuz 07.59.
  const now = new Date('2026-06-01T12:00:00.000Z');
  const weekStartsAt = new Date('2026-06-30T08:00:00.000Z');
  const weekEndsAt = new Date('2026-07-07T07:59:00.000Z');

  async function inspect(firstDataRow: Awaited<ReturnType<typeof firstDataRowOf>> | null) {
    return adapter.inspect({ scope: SCOPE, config: undefined, now, rows: [], firstDataRow });
  }

  it("returns the week of the first row's periods when no tariff of the store overlaps it", async () => {
    mocks.findPlusTariff.mockResolvedValue(null);

    const week = await inspect(await firstDataRowOf(SINGLE));

    expect(week.weekStartsAt).toEqual(weekStartsAt);
    expect(week.weekEndsAt).toEqual(weekEndsAt);
    expect(week.present.map((period) => [period.dayCount, period.layoutIndex])).toEqual([[7, 0]]);
    expect(mocks.findPlusTariff).toHaveBeenCalledTimes(1);
    expect(mocks.findPlusTariff).toHaveBeenCalledWith({
      where: {
        organizationId: SCOPE.organizationId,
        storeId: SCOPE.storeId,
        weekStartsAt: { lt: weekEndsAt },
        weekEndsAt: { gt: weekStartsAt },
      },
      select: { id: true },
    });
  });

  it('refuses a week that overlaps a tariff of the store with DUPLICATE_WEEK', async () => {
    mocks.findPlusTariff.mockResolvedValue({ id: 'tariff-1' });

    const err: unknown = await inspect(await firstDataRowOf(SINGLE)).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(err).toBeInstanceOf(WorkbookFileRejection);
    if (!(err instanceof WorkbookFileRejection)) return;
    expect(err.code).toBe('DUPLICATE_WEEK');
  });

  it('refuses a sheet without a data row with NO_PERIOD, before any query', async () => {
    const err: unknown = await inspect(null).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(err).toBeInstanceOf(WorkbookFileRejection);
    if (!(err instanceof WorkbookFileRejection)) return;
    expect(err.code).toBe('NO_PERIOD');
    expect(mocks.findPlusTariff).not.toHaveBeenCalled();
  });

  /** The rejection of an upload whose window label the export could not write (a 422 on `file`). */
  function expectUnwritableWindow(err: unknown): void {
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
  }

  // The tariff selection's probe is the whole week's label, so a window of ten days or
  // more is wider than the rehearsal proved fits; the int4 day count column could not
  // hold the second one either.
  it.each([10, 99_999_999_999])(
    'refuses a period of %s days, whose tariff selection the export could not write, before any query',
    async (days) => {
      mocks.findPlusTariff.mockResolvedValue(null);
      const firstDataRow = await firstDataRowWithDays(SINGLE, 7, days);
      expect(firstDataRow.blocks('periods').map((period) => period.tag)).toEqual([days]);

      const err: unknown = await inspect(firstDataRow).then(
        () => null,
        (rejection: unknown) => rejection,
      );

      expectUnwritableWindow(err);
      expect(mocks.findPlusTariff).not.toHaveBeenCalled();
    },
  );

  it('refuses a split week of 3 and 7 days: its whole-week file would be a 10-day window', async () => {
    mocks.findPlusTariff.mockResolvedValue(null);
    const firstDataRow = await firstDataRowWithDays(MULTI, 4, 7);
    expect(firstDataRow.blocks('periods').map((period) => period.tag)).toEqual([3, 7]);

    const err: unknown = await inspect(firstDataRow).then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expectUnwritableWindow(err);
    expect(mocks.findPlusTariff).not.toHaveBeenCalled();
  });

  it('accepts the split week of the real file: 3 and 4 days, a whole week of 7', async () => {
    mocks.findPlusTariff.mockResolvedValue(null);

    const week = await inspect(await firstDataRowOf(MULTI));

    expect(week.present.map((period) => [period.dayCount, period.layoutIndex])).toEqual([
      [3, 0],
      [4, 1],
    ]);
    expect(mocks.findPlusTariff).toHaveBeenCalledTimes(1);
  });
});

describe('Plus commission tariff adapter: form, name, response and the week index', () => {
  const week: TariffWeek = {
    present: [
      {
        label: '7 Temmuz 08.00-10 Temmuz 07.59',
        dayCount: 3,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        layoutIndex: 0,
      },
      {
        label: '10 Temmuz 08.00-14 Temmuz 07.59',
        dayCount: 4,
        startsAt: null,
        endsAt: null,
        sortOrder: 1,
        layoutIndex: 1,
      },
    ],
    weekStartsAt: null,
    weekEndsAt: null,
  };

  it('reads the file and the optional name, with no other form field', () => {
    const file = new File([new Uint8Array(SINGLE)], 'plus.xlsx');

    expect(adapter.readForm({ file, name: 'Week 27' })).toEqual({
      file,
      name: 'Week 27',
      config: undefined,
    });
    expect(adapter.readForm({ file }).name).toBeUndefined();
  });

  it("falls back to the first present period's label for the name", () => {
    expect(adapter.nameFallback(week)).toBe('7 Temmuz 08.00-10 Temmuz 07.59');
    expect(adapter.nameFallback({ ...week, present: [] })).toBeNull();
  });

  it('answers the counts of the import, with the number of stored periods', () => {
    expect(
      adapter.toResponse({
        parentId: 'tariff-1',
        name: 'Week 27',
        itemCount: 66,
        rowCount: 33,
        distinctCount: 33,
        matchedRows: 5,
        matchedDistinct: 5,
        skippedRows: 1,
        prefilledRows: 0,
        meta: week,
      }),
    ).toEqual({
      tariffId: 'tariff-1',
      productCount: 33,
      periodCount: 2,
      itemCount: 66,
      matched: 5,
      unmatched: 28,
      skippedRows: 1,
    });
  });

  it('reads a unique violation on the week column as DUPLICATE_WEEK, and nothing else', () => {
    const violation = (fields: readonly string[]): unknown => ({
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { fields } } } },
    });

    expect(adapter.rejectionForUniqueViolation(violation(['store_id', 'week_starts_at']))).toBe(
      'DUPLICATE_WEEK',
    );
    expect(adapter.rejectionForUniqueViolation(violation(['tariff_id', 'sort_order']))).toBeNull();
    expect(adapter.rejectionForUniqueViolation(new Error('boom'))).toBeNull();
  });
});
