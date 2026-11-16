import { describe, expect, it, vi } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import {
  defineLayout,
  has,
  header,
  SpreadsheetFileError,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { defineFormat } from '@/workbooks/format';
import type { FormatSummary } from '@/workbooks/formats/registry';
import { diagnoseWorkbook, selectFormat, type ReadSheet } from '@/workbooks/select-format';
import { WorkbookFileRejection } from '@/workbooks/workbook-errors';

// Synthetic formats of the discount page, read from sheets named per candidate. The
// fake `read` serves a book of named sheets: by name, or by position for an index
// selector; a sheet it does not hold is the engine's SHEET_NOT_FOUND.

const FILE = Buffer.from('synthetic workbook bytes');

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode'), price: header('Price') },
  optional: { selection: header('Selection') },
  blocks: {},
});

function syntheticFormat(sheetName: string, version: number) {
  return defineFormat({
    id: `TRENDYOL:DISCOUNT_LIST:v${version}`,
    platform: Platform.TRENDYOL,
    page: WORKBOOK_PAGES.DISCOUNT_LIST,
    sheet: { by: 'name', name: sheetName },
    layout,
    keep: has('barcode', 'text'),
    anchor: 'barcode',
    fingerprint: ['Barcode', 'Price', 'Selection'],
    mapRow: (reader, anchor) => ({ barcode: anchor, price: reader.decimal('price') }),
    writeBack: {
      selection: {
        target: { kind: 'column', key: 'selection' },
        value: { kind: 'number', scale: 2 },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
    },
    exportRequires: [['selection']],
    prefilled: 'ignore',
    defaultName: 'Synthetic list',
    filename: { kind: 'fixed', base: 'synthetic' },
  });
}

const FIRST = syntheticFormat('First', 1);
const SECOND = syntheticFormat('Second', 2);

const OWN_SUMMARY: FormatSummary = {
  id: 'TRENDYOL:DISCOUNT_LIST:v1',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.DISCOUNT_LIST,
  fingerprint: ['Barcode', 'Price', 'Selection', 'Listing'],
};

const FLASH_SUMMARY: FormatSummary = {
  id: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
  fingerprint: ['Code', 'Offer 24', 'Offer 3', 'Window'],
};

const HEPSIBURADA_SUMMARY: FormatSummary = {
  id: 'HEPSIBURADA:FLASH_PRODUCT_LIST:v1',
  platform: Platform.HEPSIBURADA,
  page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
  fingerprint: ['Sku', 'Hb Price', 'Hb Stock', 'Hb Listing'],
};

const SUMMARIES: readonly FormatSummary[] = [OWN_SUMMARY, FLASH_SUMMARY, HEPSIBURADA_SUMMARY];

const NULL_DETECTION = { detectedFormatId: null, detectedPlatform: null, detectedPage: null };

function bookReader(sheets: readonly (readonly [string, SheetData])[]) {
  return vi.fn<ReadSheet>(async (_file, sheet) => {
    const entry =
      sheet.by === 'name' ? sheets.find(([name]) => name === sheet.name) : sheets[sheet.index];
    if (entry === undefined) {
      throw new SpreadsheetFileError('SHEET_NOT_FOUND', 'Sheet not found');
    }
    return entry[1];
  });
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

async function rejectionOf(promise: Promise<unknown>): Promise<WorkbookFileRejection> {
  const err = await captureRejection(promise);
  if (!(err instanceof WorkbookFileRejection)) {
    throw new Error(`expected a WorkbookFileRejection, got ${String(err)}`);
  }
  return err;
}

const GOOD_GRID: SheetData = [
  ['Barcode', 'Price', 'Selection'],
  ['8690000000001', 10, null],
];

// A data sheet whose header row resolves no layout and matches no fingerprint.
const UNRELATED_GRID: SheetData = [
  ['Foo', 'Bar'],
  [1, 2],
];

describe('diagnoseWorkbook', () => {
  const OWN_PAGE = WORKBOOK_PAGES.DISCOUNT_LIST;

  it('returns the summary with the most hits, whatever its registry order', () => {
    // 3 of the flash fingerprint's headers and all 4 of the Hepsiburada one's.
    const headerRow = ['Code', 'Offer 24', 'Offer 3', 'Sku', 'Hb Price', 'Hb Stock', 'Hb Listing'];
    expect(diagnoseWorkbook(headerRow, [FLASH_SUMMARY, HEPSIBURADA_SUMMARY], OWN_PAGE)).toBe(
      HEPSIBURADA_SUMMARY,
    );
    expect(diagnoseWorkbook(headerRow, [HEPSIBURADA_SUMMARY, FLASH_SUMMARY], OWN_PAGE)).toBe(
      HEPSIBURADA_SUMMARY,
    );
  });

  it('returns the summary earlier in the array when two have the same hit count', () => {
    // 3 headers of each fingerprint.
    const headerRow = ['Code', 'Offer 24', 'Offer 3', 'Sku', 'Hb Price', 'Hb Stock'];
    expect(diagnoseWorkbook(headerRow, [FLASH_SUMMARY, HEPSIBURADA_SUMMARY], OWN_PAGE)).toBe(
      FLASH_SUMMARY,
    );
    expect(diagnoseWorkbook(headerRow, [HEPSIBURADA_SUMMARY, FLASH_SUMMARY], OWN_PAGE)).toBe(
      HEPSIBURADA_SUMMARY,
    );
  });
});

describe('selectFormat', () => {
  it('rejects with UNSUPPORTED_PLATFORM_FORMAT when there is no candidate', async () => {
    const read = bookReader([['First', GOOD_GRID]]);
    const err = await rejectionOf(selectFormat(FILE, [], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('UNSUPPORTED_PLATFORM_FORMAT');
    expect(read).not.toHaveBeenCalled();
  });

  it('returns the candidate whose layout resolves, with its grid and layout', async () => {
    const read = bookReader([['First', GOOD_GRID]]);
    const selected = await selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES });
    expect(selected.format).toBe(FIRST);
    expect(selected.grid).toBe(GOOD_GRID);
    expect(selected.layout.columns.get('barcode')).toBe(0);
    expect(selected.layout.columns.get('price')).toBe(1);
    expect(read).toHaveBeenCalledWith(FILE, { by: 'name', name: 'First' });
  });

  it('skips a candidate whose sheet is missing and takes the next one that resolves', async () => {
    const read = bookReader([['Second', GOOD_GRID]]);
    const selected = await selectFormat(FILE, [FIRST, SECOND], { read, summaries: SUMMARIES });
    expect(selected.format).toBe(SECOND);
    expect(selected.grid).toBe(GOOD_GRID);
  });

  it('rejects a sheet that holds only a header row with EMPTY_FILE, even when the header is wrong', async () => {
    const read = bookReader([['First', [['Something', 'Else', 'Entirely']]]]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('EMPTY_FILE');

    // A header-only sheet whose header names another page's format: EMPTY_FILE still
    // comes before the diagnosis, as the legacy import answered.
    const flashRead = bookReader([['First', [['Code', 'Offer 24', 'Offer 3']]]]);
    const flashErr = await rejectionOf(
      selectFormat(FILE, [FIRST], { read: flashRead, summaries: SUMMARIES }),
    );
    expect(flashErr.code).toBe('EMPTY_FILE');
  });

  it("names another registered format when the header carries 3 of its fingerprint's headers", async () => {
    const read = bookReader([
      [
        'First',
        [
          ['Code', 'Offer 24', 'Offer 3'],
          ['A1', 1, 2],
        ],
      ],
    ]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual({
      detectedFormatId: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
      detectedPlatform: 'TRENDYOL',
      detectedPage: 'FLASH_PRODUCT_LIST',
    });
  });

  it('names the platform of a matching summary of another platform', async () => {
    const read = bookReader([
      [
        'First',
        [
          ['Sku', 'Hb Price', 'Hb Stock'],
          ['S1', 1, 2],
        ],
      ],
    ]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual({
      detectedFormatId: 'HEPSIBURADA:FLASH_PRODUCT_LIST:v1',
      detectedPlatform: 'HEPSIBURADA',
      detectedPage: 'FLASH_PRODUCT_LIST',
    });
  });

  it('answers WRONG_FILE_FOR_PAGE with null meta when another fingerprint has only 2 hits', async () => {
    const read = bookReader([
      [
        'First',
        [
          ['Code', 'Offer 24', 'Unrelated'],
          ['A1', 1, 2],
        ],
      ],
    ]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual(NULL_DETECTION);
  });

  it('answers SHEET_NOT_FOUND when every candidate sheet is missing and the first sheet matches nothing', async () => {
    const read = bookReader([
      [
        'Other',
        [
          ['Foo', 'Bar'],
          [1, 2],
        ],
      ],
    ]);
    const err = await rejectionOf(
      selectFormat(FILE, [FIRST, SECOND], { read, summaries: SUMMARIES }),
    );
    expect(err.code).toBe('SHEET_NOT_FOUND');
  });

  it('reads the first sheet once more and names another format when every candidate sheet is missing', async () => {
    const read = bookReader([
      [
        'Other',
        [
          ['Code', 'Offer 24', 'Offer 3', 'Window'],
          ['A1', 1, 2, 'x'],
        ],
      ],
    ]);
    const err = await rejectionOf(
      selectFormat(FILE, [FIRST, SECOND], { read, summaries: SUMMARIES }),
    );
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual({
      detectedFormatId: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
      detectedPlatform: 'TRENDYOL',
      detectedPage: 'FLASH_PRODUCT_LIST',
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenLastCalledWith(FILE, { by: 'index', index: 0 });
  });

  it('never reads the first sheet again when a candidate sheet was read', async () => {
    const read = bookReader([['First', UNRELATED_GRID]]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual(NULL_DETECTION);
    expect(read.mock.calls).toEqual([[FILE, { by: 'name', name: 'First' }]]);
    expect(read).not.toHaveBeenCalledWith(FILE, { by: 'index', index: 0 });
  });

  it('answers WRONG_FILE_FOR_PAGE with null meta, not SHEET_NOT_FOUND, when only some candidate sheets are missing', async () => {
    // The first candidate's sheet is missing; the second one's is there but matches nothing.
    const read = bookReader([['Second', UNRELATED_GRID]]);
    const err = await rejectionOf(
      selectFormat(FILE, [FIRST, SECOND], { read, summaries: SUMMARIES }),
    );
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual(NULL_DETECTION);
  });

  it('lets an engine error other than SHEET_NOT_FOUND propagate untouched', async () => {
    const corrupt = new SpreadsheetFileError('CORRUPT_FILE', 'Cannot read workbook');
    const read = vi.fn<ReadSheet>(async () => {
      throw corrupt;
    });
    const err = await captureRejection(
      selectFormat(FILE, [FIRST, SECOND], { read, summaries: SUMMARIES }),
    );
    expect(err).toBe(corrupt);
  });

  it("never names the page's own format for a broken file of that page", async () => {
    // Three of the own fingerprint's headers, but the required Price column is gone.
    const read = bookReader([
      [
        'First',
        [
          ['Barcode', 'Selection', 'Listing'],
          ['8690000000001', null, 'L1'],
        ],
      ],
    ]);
    const err = await rejectionOf(selectFormat(FILE, [FIRST], { read, summaries: SUMMARIES }));
    expect(err.code).toBe('WRONG_FILE_FOR_PAGE');
    expect(err.meta).toEqual(NULL_DETECTION);
  });
});
