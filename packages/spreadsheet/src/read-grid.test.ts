import { DOMParser, Element } from '@xmldom/xmldom';
import { strFromU8, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COL_CAP, DEFAULT_MAX_BYTES, DEFAULT_ROW_CAP } from './constants';
import { SpreadsheetFileError, type SpreadsheetFileErrorCode } from './errors';
import type { SheetData } from './grid-types';
import { openUpload, type UploadParts } from './guards';
import { checkUploadParts, readGrid } from './read-grid';
import type { SheetSelector } from './read-options';
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
const ALPHABET_SIZE = 26;
const CHAR_CODE_A = 65;

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

/** 1-based column number to Excel column letters (1 -> A, 27 -> AA). */
function columnLetters(column: number): string {
  let out = '';
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / ALPHABET_SIZE)) {
    out = String.fromCharCode(CHAR_CODE_A + ((rest - 1) % ALPHABET_SIZE)) + out;
  }
  return out;
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
