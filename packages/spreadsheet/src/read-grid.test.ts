import { DOMParser, Element } from '@xmldom/xmldom';
import { strFromU8, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COL_CAP, DEFAULT_MAX_BYTES, DEFAULT_ROW_CAP } from './constants';
import { SpreadsheetFileError, type SpreadsheetFileErrorCode } from './errors';
import type { SheetData } from './grid-types';
import { openUpload, type UploadParts } from './guards';
import { checkUploadParts, readGrid, readSheet } from './read-grid';
import type { SheetSelector } from './read-options';
import { cellKey, columnLetters } from './sheet-meta';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import { expectWithinBudget } from '../tests/helpers/timing';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';

const OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
} as const;
const CAPS = { rowCap: OPTS.rowCap, colCap: OPTS.colCap } as const;

// The linear-trim guard: one shared string with 8 MB of trailing spaces, referenced by
// 200 000 cells. Trimmed once, the cells read in well under the budget; re-trimmed per
// cell, they scan 1.6 TB of spaces.
const LONG_STRING_SPACES = 8 * 1024 * 1024;
const SHARED_STRING_CELLS = 20_000;
const SHARED_STRING_COLUMNS = 50;
// Enforced in CI only (tests/helpers/timing.ts); re-trimming per cell would take hours.
const LINEAR_TRIM_BUDGET_MS = 20_000;
// A format code far beyond Excel's 255 and many xfs pointing at it: classified once per
// xf, this took seconds; the gate must reject it before any classification.
const LONG_FORMAT_CODE = 100_000;
const XFS_POINTING_AT_FORMAT = 2_000;
const GATE_FIRST_BUDGET_MS = 1_000;

function worksheet(rows: string): string {
  return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${OFFICE_RELATIONSHIPS_NS}/${type}" Target="${target}"/>`;
}

function relsOf(...relationships: readonly string[]): string {
  return `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">${relationships.join('')}</Relationships>`;
}

function workbookOf(sheets: string): string {
  return (
    `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function errorCodeOf(run: () => unknown): SpreadsheetFileErrorCode | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e.code;
    throw e;
  }
}

function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
  throw new Error('expected a SpreadsheetFileError');
}

/** A `<sheet>` entry whose relation is `rId{n}`; `attributes` go after sheetId. */
function sheetEntry(name: string, n: number, attributes = ''): string {
  return `<sheet name="${name}" sheetId="${n}"${attributes} r:id="rId${n}"/>`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readGrid', () => {
  it('reports a cap violation on the second worksheet before a reader-rule error on the first', () => {
    const beyondRow = DEFAULT_ROW_CAP + 2;
    const file = buildXlsxFixture([
      { name: 'A', xml: worksheet('<row r="1"><c r="A1" t="b"><v>yes</v></c></row>') },
      {
        name: 'B',
        xml: worksheet(`<row r="${beyondRow}"><c r="A${beyondRow}"><v>1</v></c></row>`),
      },
    ]);

    expect(errorCodeOf(() => readGrid(openUpload(file, OPTS), { caps: CAPS }))).toBe(
      'ROW_CAP_EXCEEDED',
    );
    expect(
      errorCodeOf(() => readGrid(openUpload(file, OPTS), { sheetName: 'A', caps: CAPS })),
    ).toBe('ROW_CAP_EXCEEDED');
  });

  it('parses the selected worksheet exactly once on the happy path', () => {
    const file = buildXlsxFixture([
      { name: 'A', xml: worksheetXml([['only-in-a']]) },
      { name: 'B', xml: worksheetXml([['only-in-b'], [42]]) },
    ]);
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');

    const grid = readGrid(openUpload(file, OPTS), { sheetName: 'B', caps: CAPS });

    expect(grid).toEqual([['only-in-b'], [42]]);
    const parsesOf = (marker: string): number =>
      parse.mock.calls.filter(([source]) => source.includes(marker)).length;
    expect(parsesOf('only-in-b')).toBe(1);
    // The other worksheet is parsed once too: the gate checks every worksheet.
    expect(parsesOf('only-in-a')).toBe(1);
  });

  // 20 000 cells keep the DOM near 50 MB, so this runs everywhere; re-trimming the
  // 8 MB string per cell would still scan 160 billion characters. The parts go to
  // readGrid directly: the guard is about the reader, not the gate.
  describe('linear trim', () => {
    it('reads 20 000 references to one 8 MB shared string in linear time', () => {
      const rowCount = SHARED_STRING_CELLS / SHARED_STRING_COLUMNS;
      const letters = Array.from({ length: SHARED_STRING_COLUMNS }, (_, i) => columnLetters(i + 1));
      const rows: string[] = [];
      for (let r = 1; r <= rowCount; r += 1) {
        const cells = letters.map((column) => `<c r="${column}${r}" t="s"><v>0</v></c>`);
        rows.push(`<row r="${r}">${cells.join('')}</row>`);
      }
      const parts: UploadParts = {
        [RELS_PART]: strToU8(
          relsOf(
            relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
            relationship('rId2', 'sharedStrings', 'sharedStrings.xml'),
          ),
        ),
        [WORKBOOK_PART]: strToU8(workbookOf('<sheet name="S" sheetId="1" r:id="rId1"/>')),
        [SHEET_PART]: strToU8(worksheet(rows.join(''))),
        [SHARED_STRINGS_PART]: strToU8(
          `${XML_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"><si><t>x${' '.repeat(LONG_STRING_SPACES)}</t></si></sst>`,
        ),
      };

      const started = performance.now();
      const grid = readGrid(parts, { caps: CAPS });
      const elapsedMs = performance.now() - started;

      expect(grid).toHaveLength(rowCount);
      expect(grid[rowCount - 1]?.[SHARED_STRING_COLUMNS - 1]).toBe('x');
      expectWithinBudget(elapsedMs, LINEAR_TRIM_BUDGET_MS);
    });
  });
});

describe('readGrid: strict sheet selection', () => {
  const DATA_ROWS = [['Barkod'], ['B1']];
  // A cell the reader rejects (a boolean that is not 0 or 1).
  const BROKEN_ROW = '<row r="1"><c r="A1" t="b"><v>yes</v></c></row>';

  function helpFirstFile(): Buffer {
    return buildXlsxFixture([
      { name: 'Help', xml: worksheetXml([['help text']]) },
      { name: 'Veri', xml: worksheetXml(DATA_ROWS) },
    ]);
  }

  function readWith(file: Buffer, sheet: SheetSelector): SheetData {
    return readGrid(openUpload(file, OPTS), { sheet, caps: CAPS });
  }

  it('reads the sheet a name or an index selects, past a help sheet', () => {
    const file = helpFirstFile();

    expect(readWith(file, { by: 'name', name: 'Veri' })).toEqual(DATA_ROWS);
    expect(readWith(file, { by: 'index', index: 1 })).toEqual(DATA_ROWS);
    expect(readWith(file, { by: 'index', index: 0 })).toEqual([['help text']]);
  });

  it('takes the first of two sheets with the same name', () => {
    const file = buildXlsxFixture([
      { name: 'Veri', xml: worksheetXml(DATA_ROWS) },
      { name: 'Veri', xml: worksheetXml([['second']]) },
    ]);

    expect(readWith(file, { by: 'name', name: 'Veri' })).toEqual(DATA_ROWS);
  });

  it('counts hidden and very hidden sheets in the index', () => {
    const parts: UploadParts = {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'worksheet', 'worksheets/sheet2.xml'),
          relationship('rId3', 'worksheet', 'worksheets/sheet3.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(
        workbookOf(
          sheetEntry('Hidden', 1, ' state="hidden"') +
            sheetEntry('VeryHidden', 2, ' state="veryHidden"') +
            sheetEntry('Visible', 3),
        ),
      ),
      [SHEET_PART]: strToU8(worksheetXml([['hidden']])),
      'xl/worksheets/sheet2.xml': strToU8(worksheetXml([['very hidden']])),
      'xl/worksheets/sheet3.xml': strToU8(worksheetXml([['visible']])),
    };
    const readIndex = (index: number): SheetData =>
      readGrid(parts, { sheet: { by: 'index', index }, caps: CAPS });

    expect(readIndex(0)).toEqual([['hidden']]);
    expect(readIndex(1)).toEqual([['very hidden']]);
    expect(readIndex(2)).toEqual([['visible']]);
  });

  it('reads a sheet whose relation is not a worksheet as CORRUPT_FILE', () => {
    const parts: UploadParts = {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'chartsheet', 'chartsheets/sheet1.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(workbookOf(sheetEntry('Data', 1) + sheetEntry('Chart', 2))),
      [SHEET_PART]: strToU8(worksheetXml([['d']])),
    };

    expect(
      errorCodeOf(() => readGrid(parts, { sheet: { by: 'index', index: 1 }, caps: CAPS })),
    ).toBe('CORRUPT_FILE');
    expect(
      errorCodeOf(() => readGrid(parts, { sheet: { by: 'name', name: 'Chart' }, caps: CAPS })),
    ).toBe('CORRUPT_FILE');
  });

  it('throws SHEET_NOT_FOUND for an index beyond the list or a name no sheet has', () => {
    const file = helpFirstFile();

    const byIndex = fileErrorOf(() => readWith(file, { by: 'index', index: 2 }));
    expect(byIndex.code).toBe('SHEET_NOT_FOUND');
    expect(byIndex.meta).toEqual({ by: 'index' });
    const byName = fileErrorOf(() => readWith(file, { by: 'name', name: 'Nope' }));
    expect(byName.code).toBe('SHEET_NOT_FOUND');
    expect(byName.meta).toEqual({ by: 'name' });
    // The name must match exactly.
    expect(errorCodeOf(() => readWith(file, { by: 'name', name: 'veri' }))).toBe('SHEET_NOT_FOUND');
  });

  it('reports a gate error, then a held reader error, before a missing sheet', () => {
    const beyondRow = DEFAULT_ROW_CAP + 2;
    const capViolation = buildXlsxFixture([
      { name: 'A', xml: worksheetXml([['a']]) },
      {
        name: 'B',
        xml: worksheet(`<row r="${beyondRow}"><c r="A${beyondRow}"><v>1</v></c></row>`),
      },
    ]);
    const brokenStrings: UploadParts = {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'sharedStrings', 'sharedStrings.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(workbookOf(sheetEntry('S', 1))),
      [SHEET_PART]: strToU8(worksheetXml([[1]])),
      // A run without text breaks the reader.
      [SHARED_STRINGS_PART]: strToU8(
        `${XML_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"><si><r/></si></sst>`,
      ),
    };

    expect(errorCodeOf(() => readWith(capViolation, { by: 'name', name: 'Missing' }))).toBe(
      'ROW_CAP_EXCEEDED',
    );
    expect(errorCodeOf(() => readWith(capViolation, { by: 'index', index: 5 }))).toBe(
      'ROW_CAP_EXCEEDED',
    );
    expect(
      errorCodeOf(() =>
        readGrid(brokenStrings, { sheet: { by: 'name', name: 'Missing' }, caps: CAPS }),
      ),
    ).toBe('CORRUPT_FILE');
  });

  it('reads a broken selected sheet as CORRUPT_FILE, without falling back to the first sheet', () => {
    const file = buildXlsxFixture([
      { name: 'A', xml: worksheetXml([['a']]) },
      { name: 'B', xml: worksheet(BROKEN_ROW) },
    ]);

    // The legacy sheetName path falls back to the first sheet.
    expect(readGrid(openUpload(file, OPTS), { sheetName: 'B', caps: CAPS })).toEqual([['a']]);
    expect(errorCodeOf(() => readWith(file, { by: 'name', name: 'B' }))).toBe('CORRUPT_FILE');
    expect(errorCodeOf(() => readWith(file, { by: 'index', index: 1 }))).toBe('CORRUPT_FILE');
  });

  it('reads a workbook without named sheets as CORRUPT_FILE, not SHEET_NOT_FOUND', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['a']]) }], {
      [WORKBOOK_PART]: workbookOf(''),
    });

    expect(errorCodeOf(() => readWith(file, { by: 'index', index: 0 }))).toBe('CORRUPT_FILE');
    expect(errorCodeOf(() => readWith(file, { by: 'name', name: 'Sheet1' }))).toBe('CORRUPT_FILE');
  });
});

// The patcher keeps a cell's style and never looks inside AlternateContent, so the
// reader refuses what the export could not write back faithfully.
describe('readGrid: cell styles and AlternateContent in the sheet data', () => {
  const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const TWO_XF_STYLES =
    `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}">` +
    '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="0"/></cellXfs></styleSheet>';
  const FIRST_ROW = '<row r="1"><c r="A1"><v>1</v></c></row>';

  function alternateContent(inner: string): string {
    return (
      `<mc:AlternateContent xmlns:mc="${MARKUP_COMPATIBILITY_NS}">` +
      `<mc:Choice Requires="x14">${inner}</mc:Choice></mc:AlternateContent>`
    );
  }

  /** A one-sheet workbook with two cellXfs entries whose worksheet part is `xml`. */
  function styledParts(xml: string): UploadParts {
    return {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'styles', 'styles.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(workbookOf(sheetEntry('S', 1))),
      [SHEET_PART]: strToU8(xml),
      [STYLES_PART]: strToU8(TWO_XF_STYLES),
    };
  }

  /** A worksheet whose root holds `sheetData` with `rows`, then `afterSheetData`. */
  function worksheetWith(rows: string, afterSheetData: string): string {
    return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows}</sheetData>${afterSheetData}</worksheet>`;
  }

  it('refuses an empty cell whose style index names no cellXfs entry', () => {
    const parts = styledParts(worksheet(`${FIRST_ROW}<row r="2"><c r="A2" s="9"/></row>`));

    const error = fileErrorOf(() => readGrid(parts, { caps: CAPS }));

    expect(error.code).toBe('CORRUPT_FILE');
    expect(String(error.meta.cause)).toContain('Cell style not found');
    expect(error.meta.rule).toBe('cellStyleNotFound');
  });

  it('reads an empty cell with an existing style index as null', () => {
    const parts = styledParts(
      worksheet(`${FIRST_ROW}<row r="2"><c r="A2" s="1"/><c r="B2"><v>5</v></c></row>`),
    );

    expect(readGrid(parts, { caps: CAPS })).toEqual([
      [1, null],
      [null, 5],
    ]);
  });

  it('refuses AlternateContent directly under sheetData', () => {
    const parts = styledParts(
      worksheet(`${FIRST_ROW}${alternateContent('<row r="2"><c r="A2"><v>2</v></c></row>')}`),
    );

    expect(errorCodeOf(() => readGrid(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
    expect(errorCodeOf(() => readSheet(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
    expect(fileErrorOf(() => readGrid(parts, { caps: CAPS })).meta.rule).toBe(
      'alternateContentInSheetData',
    );
  });

  it('refuses AlternateContent directly under a row', () => {
    const parts = styledParts(
      worksheet(
        `<row r="1"><c r="A1"><v>1</v></c>${alternateContent('<c r="B1"><v>2</v></c>')}</row>`,
      ),
    );

    expect(errorCodeOf(() => readGrid(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
    expect(errorCodeOf(() => readSheet(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
  });

  // Any depth below sheetData: Excel may apply a branch the reader never looked at.
  it.each([
    ['inside a cell', `<row r="1"><c r="A1">${alternateContent('<v>2</v>')}<v>1</v></c></row>`],
    [
      'inside the inline string of a cell',
      `<row r="1"><c r="A1" t="inlineStr"><is>${alternateContent('<t>b</t>')}<t>a</t></is></c></row>`,
    ],
  ])('refuses AlternateContent %s', (_label, rows) => {
    const parts = styledParts(worksheet(rows));

    expect(errorCodeOf(() => readSheet(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
    expect(fileErrorOf(() => readGrid(parts, { caps: CAPS })).meta.rule).toBe(
      'alternateContentInSheetData',
    );
  });

  it('still reads AlternateContent under the root next to sheetData', () => {
    const parts = styledParts(
      worksheetWith(
        FIRST_ROW,
        alternateContent('<mergeCells><mergeCell ref="B2:C3"/></mergeCells>'),
      ),
    );

    expect(readGrid(parts, { caps: CAPS })).toEqual([[1]]);
    expect(readSheet(parts, { caps: CAPS }).mergeRefs).toEqual(['B2:C3']);
  });
});

describe('readGrid: unexpected exceptions', () => {
  it('reports an exception nothing anticipated as CORRUPT_FILE, as the old reader did', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);
    const parts = openUpload(file, OPTS);
    vi.spyOn(Element.prototype, 'getAttribute').mockImplementation(() => {
      throw new TypeError('unexpected');
    });

    expect(errorCodeOf(() => readGrid(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
  });
});

describe('readSheet', () => {
  const SECOND_SHEET_PART = 'xl/worksheets/sheet2.xml';
  const SHEET_DATA_END = '</sheetData>';
  const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const ONE_CELL_ROW = '<row r="1"><c r="A1"><v>1</v></c></row>';
  // Two cells, then a cell the reader rejects (a boolean that is not 0 or 1).
  const ROW_BROKEN_AFTER_TWO_CELLS =
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1" t="b"><v>yes</v></c></row>';

  /** A worksheet whose root holds `sheetData` with `rows`, then `afterSheetData`. */
  function worksheetWith(rows: string, afterSheetData: string): string {
    return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows}</sheetData>${afterSheetData}</worksheet>`;
  }

  it('reports the part of the sheet an index selects', () => {
    const file = buildXlsxFixture([
      { name: 'A', xml: worksheetXml([['a']]) },
      { name: 'B', xml: worksheetXml([['b']]) },
    ]);

    const reading = readSheet(openUpload(file, OPTS), {
      sheet: { by: 'index', index: 1 },
      caps: CAPS,
    });

    expect(reading.grid).toEqual([['b']]);
    expect(reading.partPath).toBe(SECOND_SHEET_PART);
    expect(reading.partIsBookPart).toBe(false);
  });

  it('reports the first sheet for a legacy sheetName no sheet has', () => {
    const file = buildXlsxFixture([
      { name: 'A', xml: worksheetXml([['a']]) },
      { name: 'B', xml: worksheetXml([['b']]) },
    ]);

    const reading = readSheet(openUpload(file, OPTS), { sheetName: 'Missing', caps: CAPS });

    expect(reading.grid).toEqual([['a']]);
    expect(reading.partPath).toBe(SHEET_PART);
  });

  it('reports the first sheet, its own cells and merges when a named sheet breaks a reader rule', () => {
    const first = worksheetXml([['a'], ['b']]).replace(
      SHEET_DATA_END,
      `${SHEET_DATA_END}<mergeCells><mergeCell ref="A5:B6"/></mergeCells>`,
    );
    const broken = worksheetWith(
      ROW_BROKEN_AFTER_TWO_CELLS,
      '<mergeCells><mergeCell ref="C1:D2"/></mergeCells>',
    );
    const file = buildXlsxFixture([
      { name: 'A', xml: first },
      { name: 'B', xml: broken },
    ]);

    const reading = readSheet(openUpload(file, OPTS), { sheetName: 'B', caps: CAPS });

    expect(reading.grid).toEqual([['a'], ['b']]);
    expect(reading.partPath).toBe(SHEET_PART);
    expect(reading.cellKeys).toEqual([cellKey(1, 1), cellKey(2, 1)]);
    expect(reading.mergeRefs).toEqual(['A5:B6']);
  });

  it('lists the key of every cell the reader placed, in document order', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a', null, 'c'], [1]]) }]);

    const reading = readSheet(openUpload(file, OPTS), { caps: CAPS });

    expect(reading.cellKeys).toEqual([1025, 1027, 2049]);
  });

  it('reports the date table it read the cells with, one entry per cellXfs entry', () => {
    const file = buildXlsxFixture(
      [{ name: 'S', xml: worksheet('<row r="1"><c r="A1" s="1"><v>45000</v></c></row>') }],
      {
        [RELS_PART]: relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'styles', 'styles.xml'),
        ),
        [STYLES_PART]:
          `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}"><cellXfs count="3">` +
          '<xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="2"/></cellXfs></styleSheet>',
      },
    );

    const reading = readSheet(openUpload(file, OPTS), { caps: CAPS });

    expect(reading.xfIsDate).toEqual([false, true, false]);
    expect(reading.grid[0]?.[0]).toBeInstanceOf(Date);
  });

  it('reports an empty date table for a workbook without a styles part', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);

    expect(readSheet(openUpload(file, OPTS), { caps: CAPS }).xfIsDate).toEqual([]);
  });

  it('reports the styles part it read, and whether another part the reader reads shares it', () => {
    const styles =
      `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}"><cellXfs count="1">` +
      '<xf numFmtId="0"/></cellXfs></styleSheet>';
    const own = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }], {
      [RELS_PART]: relsOf(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'styles', 'styles.xml'),
      ),
      [STYLES_PART]: styles,
    });
    const sharedWithStrings = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }], {
      [RELS_PART]: relsOf(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'sharedStrings', 'styles.xml'),
        relationship('rId3', 'styles', 'styles.xml'),
      ),
      [STYLES_PART]: styles,
    });
    const none = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);

    const ownReading = readSheet(openUpload(own, OPTS), { caps: CAPS });
    const sharedReading = readSheet(openUpload(sharedWithStrings, OPTS), { caps: CAPS });
    const noneReading = readSheet(openUpload(none, OPTS), { caps: CAPS });

    expect(ownReading.stylesPath).toBe(STYLES_PART);
    expect(ownReading.stylesPartIsShared).toBe(false);
    expect(sharedReading.stylesPath).toBe(STYLES_PART);
    expect(sharedReading.stylesPartIsShared).toBe(true);
    expect(noneReading.stylesPath).toBeNull();
    expect(noneReading.stylesPartIsShared).toBe(false);
  });

  it('lists the merge refs, and reads the same grid as readGrid', () => {
    const xml = worksheetWith(
      '<row r="2"><c r="B2"><v>1</v></c></row>',
      '<mergeCells count="1"><mergeCell ref="B2:C3"/></mergeCells>',
    );
    const file = buildXlsxFixture([{ name: 'S', xml }]);

    const reading = readSheet(openUpload(file, OPTS), { caps: CAPS });

    expect(reading.mergeRefs).toEqual(['B2:C3']);
    expect(readGrid(openUpload(file, OPTS), { caps: CAPS })).toEqual(reading.grid);
  });

  it('takes merge refs from every mergeCells block, a missing ref as empty', () => {
    const xml = worksheetWith(
      ONE_CELL_ROW,
      '<mergeCells><mergeCell ref="B2:C3"/><mergeCell/></mergeCells>' +
        '<mergeCells><mergeCell ref="E5:F6"/></mergeCells>',
    );
    const file = buildXlsxFixture([{ name: 'S', xml }]);

    expect(readSheet(openUpload(file, OPTS), { caps: CAPS }).mergeRefs).toEqual([
      'B2:C3',
      '',
      'E5:F6',
    ]);
  });

  it('keeps the real merge refs after a decoy block in a foreign namespace', () => {
    const xml = worksheetWith(
      ONE_CELL_ROW,
      '<d:mergeCells xmlns:d="urn:decoy"><d:mergeCell ref="Z99"/></d:mergeCells>' +
        '<mergeCells><mergeCell ref="B2:C3"/></mergeCells>',
    );
    const file = buildXlsxFixture([{ name: 'S', xml }]);

    const reading = readSheet(openUpload(file, OPTS), { caps: CAPS });

    expect(reading.mergeRefs).toEqual(['Z99', 'B2:C3']);
    expect(readGrid(openUpload(file, OPTS), { caps: CAPS })).toEqual(reading.grid);
  });

  it('takes merge refs from both branches of an AlternateContent block', () => {
    const xml = worksheetWith(
      ONE_CELL_ROW,
      `<mc:AlternateContent xmlns:mc="${MARKUP_COMPATIBILITY_NS}">` +
        '<mc:Choice Requires="x14"><mergeCells><mergeCell ref="B2:C3"/></mergeCells></mc:Choice>' +
        '<mc:Fallback><mergeCells><mergeCell ref="E5:F6"/></mergeCells></mc:Fallback>' +
        '</mc:AlternateContent>',
    );
    const file = buildXlsxFixture([{ name: 'S', xml }]);

    expect(readSheet(openUpload(file, OPTS), { caps: CAPS }).mergeRefs).toEqual(['B2:C3', 'E5:F6']);
  });

  it('lists no merge refs for a sheet without mergeCells', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);

    expect(readSheet(openUpload(file, OPTS), { caps: CAPS }).mergeRefs).toEqual([]);
  });

  it('lists the ref of every array and data table formula, not of plain or shared ones', () => {
    const xml = worksheetWith(
      '<row r="1">' +
        '<c r="A1"><f>1+1</f><v>2</v></c>' +
        '<c r="B1"><f t="shared" ref="B1:B2" si="0">A1</f><v>2</v></c>' +
        '<c r="C1"><f t="array" ref="C1:C2">A1:A2*2</f><v>4</v></c>' +
        '<c r="D1"><f t="dataTable" ref="D1:E2" dt2D="0" dtr="0" r1="A1"/><v>0</v></c>' +
        '<c r="F1"><f t="array">A1</f><v>2</v></c>' +
        '</row>' +
        '<row r="2"><c r="B2"><f t="shared" si="0"/><v>3</v></c><c r="C2"><v>5</v></c></row>',
      '',
    );
    const file = buildXlsxFixture([{ name: 'S', xml }]);

    const reading = readSheet(openUpload(file, OPTS), { caps: CAPS });

    expect(reading.formulaRangeRefs).toEqual(['C1:C2', 'D1:E2', '']);
    expect(readGrid(openUpload(file, OPTS), { caps: CAPS })).toEqual(reading.grid);
  });

  it('lists the formula ranges of the first sheet when a named sheet breaks a reader rule', () => {
    const first = worksheetWith(
      '<row r="1"><c r="A1"><f t="array" ref="A1:A3">1</f><v>1</v></c></row>',
      '',
    );
    const broken = worksheetWith(
      '<row r="1"><c r="A1"><f t="array" ref="A1:B2">1</f><v>1</v></c>' +
        '<c r="C1" t="b"><v>yes</v></c></row>',
      '',
    );
    const file = buildXlsxFixture([
      { name: 'A', xml: first },
      { name: 'B', xml: broken },
    ]);

    const reading = readSheet(openUpload(file, OPTS), { sheetName: 'B', caps: CAPS });

    expect(reading.partPath).toBe(SHEET_PART);
    expect(reading.formulaRangeRefs).toEqual(['A1:A3']);
  });

  it('lists no formula ranges for a sheet without array or data table formulas', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);

    expect(readSheet(openUpload(file, OPTS), { caps: CAPS }).formulaRangeRefs).toEqual([]);
  });

  it('flags a worksheet part that is also a book part', () => {
    const parts: UploadParts = {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'styles.xml'),
          relationship('rId2', 'styles', 'styles.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(workbookOf(sheetEntry('S', 1))),
      [STYLES_PART]: strToU8(worksheetXml([['a']])),
    };

    const reading = readSheet(parts, { caps: CAPS });

    expect(reading.grid).toEqual([['a']]);
    expect(reading.partPath).toBe(STYLES_PART);
    expect(reading.partIsBookPart).toBe(true);
    expect(reading.stylesPath).toBe(STYLES_PART);
    expect(reading.stylesPartIsShared).toBe(true);
  });

  it('reports an exception nothing anticipated as CORRUPT_FILE, as readGrid does', () => {
    const file = buildXlsxFixture([{ name: 'S', xml: worksheetXml([['a']]) }]);
    const parts = openUpload(file, OPTS);
    vi.spyOn(Element.prototype, 'getAttribute').mockImplementation(() => {
      throw new TypeError('unexpected');
    });

    expect(errorCodeOf(() => readSheet(parts, { caps: CAPS }))).toBe('CORRUPT_FILE');
  });
});

describe('readGrid: gate before reader work', () => {
  it('rejects an over-long number format before classifying it for every xf', () => {
    const parts: UploadParts = {
      [RELS_PART]: strToU8(
        relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'styles', 'styles.xml'),
        ),
      ),
      [WORKBOOK_PART]: strToU8(workbookOf('<sheet name="S" sheetId="1" r:id="rId1"/>')),
      [SHEET_PART]: strToU8(worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')),
      [STYLES_PART]: strToU8(
        `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}">` +
          `<numFmts><numFmt numFmtId="164" formatCode="${'y'.repeat(LONG_FORMAT_CODE)}"/></numFmts>` +
          `<cellXfs>${'<xf numFmtId="164"/>'.repeat(XFS_POINTING_AT_FORMAT)}</cellXfs></styleSheet>`,
      ),
    };

    const started = performance.now();
    expect(errorCodeOf(() => readGrid(parts, { caps: CAPS }))).toBe('UNSAFE_CONTENT');
    expectWithinBudget(performance.now() - started, GATE_FIRST_BUDGET_MS);
  });
});

describe('openUpload', () => {
  it('returns only the reader parts, in the order the gate picked them', () => {
    const sheet = worksheetXml([['a']]);
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: sheet }], {
      [RELS_PART]: relsOf(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'sharedStrings', 'sharedStrings.xml'),
        relationship('rId3', 'styles', 'styles.xml'),
        relationship('rId4', 'theme', 'theme/theme1.xml'),
      ),
      [SHARED_STRINGS_PART]: `${XML_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"/>`,
      [STYLES_PART]: `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}"/>`,
      'xl/theme/theme1.xml': `${XML_DECLARATION}<a:theme xmlns:a="urn:theme"/>`,
      'xl/worksheets/orphan.xml': worksheetXml([['orphan']]),
      'docProps/app.xml': `${XML_DECLARATION}<Properties/>`,
      'xl/media/image1.png': 'not an image',
    });

    const parts = openUpload(file, OPTS);

    expect(Object.keys(parts)).toEqual([
      RELS_PART,
      WORKBOOK_PART,
      SHEET_PART,
      SHARED_STRINGS_PART,
      STYLES_PART,
    ]);
    const sheetBytes = parts[SHEET_PART];
    expect(sheetBytes === undefined ? undefined : strFromU8(sheetBytes)).toBe(sheet);
  });
});

describe('checkUploadParts', () => {
  it('runs only the gate checks: a sheetless workbook passes, a cap violation does not', () => {
    const sheetless = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['a']]) }], {
      [WORKBOOK_PART]: `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}"/>`,
    });
    const tooWide = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml([Array.from({ length: DEFAULT_COL_CAP + 1 }, () => 1)]) },
    ]);

    expect(errorCodeOf(() => checkUploadParts(openUpload(sheetless, OPTS), CAPS))).toBeNull();
    expect(errorCodeOf(() => readGrid(openUpload(sheetless, OPTS), { caps: CAPS }))).toBe(
      'CORRUPT_FILE',
    );
    expect(errorCodeOf(() => checkUploadParts(openUpload(tooWide, OPTS), CAPS))).toBe(
      'COL_CAP_EXCEEDED',
    );
  });
});
