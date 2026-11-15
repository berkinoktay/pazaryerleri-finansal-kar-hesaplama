import { describe, expect, it } from 'vitest';

import { DEFAULT_COL_CAP, DEFAULT_MAX_BYTES, DEFAULT_ROW_CAP } from './constants';
import { SpreadsheetFileError, type SpreadsheetFileErrorCode } from './errors';
import type { SheetData } from './grid-types';
import { openUpload } from './guards';
import { readGrid } from './read-grid';
import { buildXlsxFixture } from './testing/build-xlsx';
import { FIXTURE_PINS, gridSha256, readFixture } from '../tests/helpers/fixture-pins';

// The own grid reader on the parity corpus. Every `expected` below was taken from the
// old pipeline's output (the read copy re-zipped and read by the 9.2.0 reader library
// the engine replaced) and reviewed against the reader contract; while that pipeline
// existed, each case was asserted on both readers. The cases named "divergence" are
// the accepted differences from the old pipeline (crafted files only, listed in the
// PR body): the old pipeline read the two style index cells as the number 5, and the
// valueless cell with an unknown style as null.

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_TYPE = `${OFFICE_RELATIONSHIPS_NS}/worksheet`;
const SHARED_STRINGS_TYPE = `${OFFICE_RELATIONSHIPS_NS}/sharedStrings`;
const STYLES_TYPE = `${OFFICE_RELATIONSHIPS_NS}/styles`;
const CHARTSHEET_TYPE = `${OFFICE_RELATIONSHIPS_NS}/chartsheet`;
const RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';

const OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
} as const;
const CAPS = { rowCap: OPTS.rowCap, colCap: OPTS.colCap } as const;

type ParityOutcome = SheetData | { readonly error: SpreadsheetFileErrorCode };

interface ParityCase {
  readonly name: string;
  readonly file: () => Buffer;
  readonly sheetName?: string;
  readonly expected: ParityOutcome;
}

const CORRUPT: ParityOutcome = { error: 'CORRUPT_FILE' };

// ---------------------------------------------------------------------------
// Workbook builders

interface SheetSpec {
  readonly name: string;
  /** Inner XML of `<sheetData>`. */
  readonly rows: string;
}

interface BookOptions {
  /** Inner XML of `<sst>`: adds the shared strings part and its relationship. */
  readonly sharedStrings?: string;
  /** Inner XML of `<styleSheet>`: adds the styles part and its relationship. */
  readonly styles?: string;
  /** Markup inside `<workbook>` before `<sheets>`, such as `<workbookPr/>`. */
  readonly workbookPr?: string;
  /** Replaces the generated workbook rels. */
  readonly rels?: string;
  /** Replaces the generated workbook part. */
  readonly workbook?: string;
  /** More entries, added last. */
  readonly extra?: Readonly<Record<string, string>>;
}

function worksheet(rows: string): string {
  return `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${rows}</sheetData></worksheet>`;
}

function relationship(id: string | null, type: string, target: string): string {
  const idAttribute = id === null ? '' : ` Id="${id}"`;
  return `<Relationship${idAttribute} Type="${type}" Target="${target}"/>`;
}

function relsOf(...relationships: readonly string[]): string {
  return `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">${relationships.join('')}</Relationships>`;
}

function workbookOf(sheets: string, before = ''): string {
  return (
    `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `${before}<sheets>${sheets}</sheets></workbook>`
  );
}

function sheetEntry(name: string, relationId: string, sheetId: number): string {
  return `<sheet name="${name}" sheetId="${sheetId}" r:id="${relationId}"/>`;
}

function bookFile(sheets: readonly SheetSpec[], options: BookOptions = {}): Buffer {
  const relationships = sheets.map((_, i) =>
    relationship(`rId${i + 1}`, WORKSHEET_TYPE, `worksheets/sheet${i + 1}.xml`),
  );
  const extra: Record<string, string> = {};
  if (options.sharedStrings !== undefined) {
    relationships.push(relationship('rIdStrings', SHARED_STRINGS_TYPE, 'sharedStrings.xml'));
    extra[SHARED_STRINGS_PART] =
      `${XML_DECLARATION}<sst xmlns="${SPREADSHEET_NS}">${options.sharedStrings}</sst>`;
  }
  if (options.styles !== undefined) {
    relationships.push(relationship('rIdStyles', STYLES_TYPE, 'styles.xml'));
    extra[STYLES_PART] =
      `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}">${options.styles}</styleSheet>`;
  }
  extra[RELS_PART] = options.rels ?? relsOf(...relationships);
  if (options.workbook !== undefined) {
    extra[WORKBOOK_PART] = options.workbook;
  } else if (options.workbookPr !== undefined) {
    const entries = sheets.map((s, i) => sheetEntry(s.name, `rId${i + 1}`, i + 1)).join('');
    extra[WORKBOOK_PART] = workbookOf(entries, options.workbookPr);
  }
  return buildXlsxFixture(
    sheets.map((s) => ({ name: s.name, xml: worksheet(s.rows) })),
    { ...extra, ...options.extra },
  );
}

/** A one-sheet workbook whose sheet holds `rows`. */
function oneSheet(rows: string, options: BookOptions = {}): () => Buffer {
  return () => bookFile([{ name: 'Sheet1', rows }], options);
}

function inline(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

/** One `<row>` holding `cells`; the row number is the cells' business, not this one's. */
function row(n: number, ...cells: readonly string[]): string {
  return `<row r="${n}">${cells.join('')}</row>`;
}

/** `<cellXfs>` with one `<xf>` per id; null writes an `<xf>` without numFmtId. */
function cellXfs(...numFmtIds: readonly (string | null)[]): string {
  const xfs = numFmtIds
    .map((id) => (id === null ? '<xf fontId="0"/>' : `<xf numFmtId="${id}" fontId="0"/>`))
    .join('');
  return `<cellXfs count="${numFmtIds.length}">${xfs}</cellXfs>`;
}

/** `<numFmts>` with one `<numFmt>` per entry, written as given. */
function numFmts(...numFmt: readonly string[]): string {
  return `<numFmts count="${numFmt.length}">${numFmt.join('')}</numFmts>`;
}

// Style 0 is a plain number, style 1 a date (built-in id 14).
const DATE_STYLES = cellXfs('0', '14');

function serial(ref: string, value: string, style: string): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

const DAY_45000_NOON = new Date('2023-03-15T12:00:00.000Z');
const DAY_45000_MORNING = new Date('2023-03-15T06:00:00.000Z');
const DAY_45000 = new Date('2023-03-15T00:00:00.000Z');
const DAY_45000_IN_1904 = new Date('2027-03-16T00:00:00.000Z');
const QUARTER_DAY_SERIAL = new Date('1899-12-30T06:00:00.000Z');
// A `t="d"` value without an offset is read in the machine's time zone: the owner's
// machine runs in Istanbul time, CI in UTC. Both readers use `new Date(raw)`.
const LOCAL_DATE_TIME = '2023-03-15T10:30:00';

function twoSheets(first: string, second: string): () => Buffer {
  return () =>
    bookFile([
      { name: 'A', rows: first },
      { name: 'B', rows: second },
    ]);
}

const SHEET_A = row(1, inline('A1', 'a'));
const SHEET_B = row(1, inline('A1', 'b'));
const BROKEN_SHEET = row(1, '<c r="A1" t="b"><v>yes</v></c>');

// ---------------------------------------------------------------------------
// Cases

const CELL_CASES: readonly ParityCase[] = [
  {
    name: 'inline strings are trimmed and an empty one is null',
    file: oneSheet(
      row(1, inline('A1', '  a '), '<c r="B1" t="inlineStr"><is><t/></is></c>', inline('C1', 'c')),
    ),
    expected: [['a', null, 'c']],
  },
  {
    name: 'a rich inline string breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="inlineStr"><is><r><t>x</t></r></is></c>')),
    expected: CORRUPT,
  },
  {
    name: 'an inline string whose first child is not is breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="inlineStr"><v>x</v><is><t>a</t></is></c>')),
    expected: CORRUPT,
  },
  {
    name: 'shared strings by index, an empty index is 0',
    file: oneSheet(row(1, '<c r="A1" t="s"><v>1</v></c>', '<c r="B1" t="s"><v/></c>'), {
      sharedStrings: '<si><t>x</t></si><si><t>y</t></si>',
    }),
    expected: [['y', 'x']],
  },
  {
    name: 'a shared string index past the end breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="s"><v>2</v></c>'), {
      sharedStrings: '<si><t>x</t></si><si><t>y</t></si>',
    }),
    expected: CORRUPT,
  },
  {
    name: 'a negative shared string index breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="s"><v>-1</v></c>'), {
      sharedStrings: '<si><t>x</t></si><si><t>y</t></si>',
    }),
    expected: CORRUPT,
  },
  {
    name: 'a fractional shared string index breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="s"><v>0.5</v></c>'), {
      sharedStrings: '<si><t>x</t></si><si><t>y</t></si>',
    }),
    expected: CORRUPT,
  },
  {
    name: 'a shared string cell without a shared strings part breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="s"><v>0</v></c>')),
    expected: CORRUPT,
  },
  {
    name: 'booleans are 1 and 0',
    file: oneSheet(row(1, '<c r="A1" t="b"><v>1</v></c>', '<c r="B1" t="b"><v>0</v></c>')),
    expected: [[true, false]],
  },
  {
    name: 'a boolean other than 1 or 0 breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="b"><v>true</v></c>')),
    expected: CORRUPT,
  },
  {
    name: 'error cells keep their raw text and blank cells are null',
    file: oneSheet(
      row(
        1,
        '<c r="A1" t="e"><v>#N/A</v></c>',
        '<c r="B1" t="e"/>',
        '<c r="C1" t="e"><v> #REF! </v></c>',
        '<c r="D1" t="z"><v>5</v></c>',
        inline('E1', 'e'),
      ),
    ),
    expected: [['#ERROR_#N/A', '#ERROR_undefined', '#ERROR_ #REF! ', null, 'e']],
  },
  {
    name: 'formula strings are trimmed',
    file: oneSheet(
      row(
        1,
        '<c r="A1" t="str"><f>B1</f><v> x </v></c>',
        '<c r="B1" t="str"><v>  </v></c>',
        inline('C1', 'c'),
      ),
    ),
    expected: [['x', null, 'c']],
  },
  {
    name: 'a formula string cell without a value or formula breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="str"/>')),
    expected: CORRUPT,
  },
  {
    name: 'uncached formula cells are null and cached ones keep their value',
    file: oneSheet(
      row(
        1,
        '<c r="A1" t="str"><f>B1</f></c>',
        '<c r="B1" t="s"><f>C1</f></c>',
        '<c r="C1" t="b"><f>D1</f></c>',
        '<c r="D1"><f>1+1</f><v>2</v></c>',
        inline('E1', 'e'),
      ),
    ),
    expected: [[null, null, null, 2, 'e']],
  },
  {
    name: 'numbers are read with Number',
    file: oneSheet(
      row(
        1,
        '<c r="A1"><v>1e3</v></c>',
        '<c r="B1"><v>0x10</v></c>',
        '<c r="C1"><v/></c>',
        '<c r="D1"><v> 12 </v></c>',
        '<c r="E1" t="n"><v>-4.5</v></c>',
        '<c r="F1"><v>Infinity</v></c>',
        '<c r="G1"/>',
        '<c r="H1" t=""><v>7</v></c>',
      ),
    ),
    expected: [[1000, 16, 0, 12, -4.5, Infinity, null, 7]],
  },
  {
    name: 'a number Number cannot read breaks the reader',
    file: oneSheet(row(1, '<c r="A1"><v>12abc</v></c>')),
    expected: CORRUPT,
  },
  {
    name: 'an unknown cell type breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="x"><v>1</v></c>')),
    expected: CORRUPT,
  },
];

const DATE_CASES: readonly ParityCase[] = [
  {
    name: 'built-in date format ids, with Number semantics on the id',
    file: oneSheet(
      row(
        1,
        serial('A1', '45000.5', '0'),
        serial('B1', '45000.5', '1'),
        serial('C1', '45000.5', '2'),
        serial('D1', '45000.5', '3'),
        serial('E1', '45000.5', '4'),
        serial('F1', '45000.5', '5'),
        serial('G1', '45000.5', '6'),
      ),
      { styles: cellXfs('0', '14', '22', '45', '47', '14.0', ' 22 ') },
    ),
    expected: [
      [
        45000.5,
        DAY_45000_NOON,
        DAY_45000_NOON,
        DAY_45000_NOON,
        DAY_45000_NOON,
        DAY_45000_NOON,
        DAY_45000_NOON,
      ],
    ],
  },
  {
    name: 'custom format codes: Turkish dates are dates, numbers and durations are not',
    file: oneSheet(
      row(
        1,
        serial('A1', '45000.25', '0'),
        serial('B1', '45000.25', '1'),
        serial('C1', '45000.25', '2'),
        serial('D1', '45000.25', '3'),
        serial('E1', '45000.25', '4'),
        serial('F1', '45000.25', '5'),
      ),
      {
        styles:
          numFmts(
            '<numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/>',
            '<numFmt numFmtId="165" formatCode="[$-41F]d mmmm yyyy"/>',
            '<numFmt numFmtId="166" formatCode="0.00"/>',
            '<numFmt numFmtId="167" formatCode="General"/>',
            '<numFmt numFmtId="168" formatCode="[h]:mm:ss"/>',
            '<numFmt numFmtId="169" formatCode="dd/mm/yyyy;@"/>',
          ) + cellXfs('164', '165', '166', '167', '168', '169'),
      },
    ),
    expected: [
      [DAY_45000_MORNING, DAY_45000_MORNING, 45000.25, 45000.25, 45000.25, DAY_45000_MORNING],
    ],
  },
  {
    name: 'a custom numFmt that redefines built-in id 14 is still a date',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles: numFmts('<numFmt numFmtId="14" formatCode="0.00"/>') + cellXfs('14'),
    }),
    expected: [[DAY_45000]],
  },
  {
    name: 'two numFmts with the same id: the last one wins',
    file: oneSheet(row(1, serial('A1', '45000', '0'), serial('B1', '45000', '1')), {
      styles:
        numFmts(
          '<numFmt numFmtId="164" formatCode="0.00"/>',
          '<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>',
          '<numFmt numFmtId="165" formatCode="dd.mm.yyyy"/>',
          '<numFmt numFmtId="165" formatCode="0.00"/>',
        ) + cellXfs('164', '165'),
    }),
    expected: [[DAY_45000, 45000]],
  },
  {
    name: 'a numFmt without numFmtId matches an xf whose numFmtId is "null"',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles: numFmts('<numFmt formatCode="dd.mm.yyyy"/>') + cellXfs('null'),
    }),
    expected: [[DAY_45000]],
  },
  {
    name: 'a numFmt without formatCode and an xf without numFmtId are numbers',
    file: oneSheet(row(1, serial('A1', '45000', '0'), serial('B1', '45000', '1')), {
      styles: numFmts('<numFmt numFmtId="164"/>') + cellXfs('164', null),
    }),
    expected: [[45000, 45000]],
  },
  {
    name: 'a numFmt and an xf with numFmtId "__proto__" still match',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles:
        numFmts('<numFmt numFmtId="__proto__" formatCode="dd.mm.yyyy"/>') + cellXfs('__proto__'),
    }),
    expected: [[DAY_45000]],
  },
  {
    // The reader collects number formats in an array by id: id "length" sets the
    // array's length to an object and throws a RangeError.
    name: 'a numFmt with numFmtId "length" breaks the reader, referenced or not',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles: numFmts('<numFmt numFmtId="length" formatCode="dd.mm.yyyy"/>') + cellXfs('0'),
    }),
    expected: CORRUPT,
  },
  {
    name: 'cellStyleXfs are not inherited through xfId',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles:
        '<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf xfId="0" fontId="0"/></cellXfs>',
    }),
    expected: [[45000]],
  },
  {
    name: 'styles without cellXfs: a styled cell breaks the reader',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      styles: numFmts('<numFmt numFmtId="164" formatCode="0.00"/>'),
    }),
    expected: CORRUPT,
  },
  {
    name: 'a style index without a styles part breaks the reader',
    file: oneSheet(row(1, serial('A1', '45000', '0'))),
    expected: CORRUPT,
  },
  {
    name: 'an empty style index reads a number, even without styles',
    file: oneSheet(row(1, serial('A1', '45000', ''))),
    expected: [[45000]],
  },
  {
    name: 'a style index with a leading zero breaks the reader',
    file: oneSheet(row(1, serial('A1', '45000', '01')), { styles: DATE_STYLES }),
    expected: CORRUPT,
  },
  {
    name: 'a style index past the cellXfs breaks the reader',
    file: oneSheet(row(1, serial('A1', '45000', '5')), { styles: DATE_STYLES }),
    expected: CORRUPT,
  },
  {
    name: 'a date-styled cell that is not a number breaks the reader',
    file: oneSheet(row(1, serial('A1', 'soon', '1')), { styles: DATE_STYLES }),
    expected: CORRUPT,
  },
  {
    name: 'divergence: a style on a valueless cell is looked up',
    file: oneSheet(row(1, '<c r="A1" s="9"/>', inline('B1', 'b'))),
    expected: CORRUPT,
  },
  {
    name: 'date1904="1" uses the 1904 system',
    file: oneSheet(row(1, serial('A1', '45000', '1')), {
      styles: DATE_STYLES,
      workbookPr: '<workbookPr date1904="1"/>',
    }),
    expected: [[DAY_45000_IN_1904]],
  },
  {
    name: 'date1904="true" is the 1900 system',
    file: oneSheet(row(1, serial('A1', '45000', '1')), {
      styles: DATE_STYLES,
      workbookPr: '<workbookPr date1904="true"/>',
    }),
    expected: [[DAY_45000]],
  },
  {
    name: 'a time-only serial',
    file: oneSheet(row(1, serial('A1', '0.25', '1')), { styles: DATE_STYLES }),
    expected: [[QUARTER_DAY_SERIAL]],
  },
  {
    name: 't="d" cells go through new Date, without a value they are null',
    file: oneSheet(
      row(
        1,
        `<c r="A1" t="d"><v>${LOCAL_DATE_TIME}</v></c>`,
        '<c r="B1" t="d"><v>2023-03-15T10:30:00Z</v></c>',
        '<c r="C1" t="d"/>',
        inline('D1', 'd'),
      ),
    ),
    expected: [[new Date(LOCAL_DATE_TIME), new Date('2023-03-15T10:30:00.000Z'), null, 'd']],
  },
  {
    name: 'an invalid t="d" value breaks the reader',
    file: oneSheet(row(1, '<c r="A1" t="d"><v>later</v></c>')),
    expected: CORRUPT,
  },
];

const SHARED_STRING_CASES: readonly ParityCase[] = [
  {
    name: 'shared strings: runs, phonetic runs, xml:space, CDATA, line breaks, whitespace',
    file: oneSheet(
      row(
        1,
        '<c r="A1" t="s"><v>0</v></c>',
        '<c r="B1" t="s"><v>1</v></c>',
        '<c r="C1" t="s"><v>2</v></c>',
        '<c r="D1" t="s"><v>3</v></c>',
        '<c r="E1" t="s"><v>4</v></c>',
        '<c r="F1" t="s"><v>5</v></c>',
        '<c r="G1" t="s"><v>6</v></c>',
        '<c r="H1" t="s"><v>7</v></c>',
      ),
      {
        sharedStrings:
          '<si><r><t>x</t></r><r><rPr><b/></rPr><t xml:space="preserve"> y</t></r>' +
          '<rPh sb="0" eb="1"><t>z</t></rPh></si>' +
          '<si><t xml:space="preserve"> a </t><rPh sb="0" eb="1"><t>p</t></rPh></si>' +
          '<si><t><![CDATA[<b> c]]></t></si>' +
          '<si><t>a&#13;&#10;b</t></si>' +
          '<si><t>a\r\nb</t></si>' +
          '<si><t>   </t></si>' +
          '<si></si>' +
          '<si><t>a<!--note-->b</t></si>',
      },
    ),
    expected: [['x y', 'a', '<b> c', 'a\r\nb', 'a\nb', null, null, 'ab']],
  },
  {
    name: 'a shared string run without text breaks the reader, referenced or not',
    file: oneSheet(row(1, inline('A1', 'a')), { sharedStrings: '<si><r><rPr/></r></si>' }),
    expected: CORRUPT,
  },
];

const GRID_CASES: readonly ParityCase[] = [
  {
    name: 'leading empty rows and columns are kept',
    file: oneSheet(row(3, inline('C3', 'x'))),
    expected: [
      [null, null, null],
      [null, null, null],
      [null, null, 'x'],
    ],
  },
  {
    name: 'interior empties are kept, trailing all-null columns and rows are trimmed',
    file: oneSheet(
      row(1, inline('A1', 'a'), '<c r="C1"/>', '<c r="E1" t="z"/>') +
        row(3, inline('B3', 'b')) +
        row(5, '<c r="A5"/>', '<c r="F5"/>'),
    ),
    expected: [
      ['a', null],
      [null, null],
      [null, 'b'],
    ],
  },
  {
    name: 'an all-null sheet reads as []',
    file: oneSheet(row(1, '<c r="A1"/>') + row(2, '<c r="B2" t="z"/>')),
    expected: [],
  },
  {
    name: 'an empty sheetData reads as []',
    file: oneSheet(''),
    expected: [],
  },
  {
    name: 'a cell repeated across two rows: the later one wins, even when null',
    file: oneSheet(
      row(1, inline('A1', 'first'), inline('B1', 'b')) +
        row(2, inline('A2', 'x')) +
        row(1, inline('A1', 'second')) +
        row(2, '<c r="A2"/>'),
    ),
    expected: [['second', 'b']],
  },
  {
    name: 'rows out of order are placed by their cell references',
    file: oneSheet(row(3, inline('A3', 'c')) + row(1, inline('B1', 'a'))),
    expected: [
      [null, 'a'],
      [null, null],
      ['c', null],
    ],
  },
];

const SELECTION_CASES: readonly ParityCase[] = [
  {
    name: 'a sheet selected by name',
    file: twoSheets(SHEET_A, SHEET_B),
    sheetName: 'B',
    expected: [['b']],
  },
  {
    name: 'without a name, the first sheet',
    file: twoSheets(SHEET_A, SHEET_B),
    expected: [['a']],
  },
  {
    name: 'an unknown sheet name falls back to the first sheet',
    file: twoSheets(SHEET_A, SHEET_B),
    sheetName: 'Nope',
    expected: [['a']],
  },
  {
    name: 'a named sheet that breaks a reader rule falls back to the first sheet',
    file: twoSheets(SHEET_A, BROKEN_SHEET),
    sheetName: 'B',
    expected: [['a']],
  },
  {
    name: 'a broken first sheet does not matter when the named sheet reads',
    file: twoSheets(BROKEN_SHEET, SHEET_B),
    sheetName: 'B',
    expected: [['b']],
  },
  {
    name: 'both sheets broken',
    file: twoSheets(BROKEN_SHEET, BROKEN_SHEET),
    sheetName: 'B',
    expected: CORRUPT,
  },
  {
    name: 'the first sheet named and broken',
    file: twoSheets(BROKEN_SHEET, SHEET_B),
    sheetName: 'A',
    expected: CORRUPT,
  },
  {
    name: 'two sheets with the same name: the first one',
    file: () =>
      bookFile([
        { name: 'A', rows: SHEET_A },
        { name: 'A', rows: SHEET_B },
      ]),
    sheetName: 'A',
    expected: [['a']],
  },
  {
    name: 'a named sheet whose relationship is a chartsheet falls back to the first sheet',
    file: oneSheet(row(1, inline('A1', 'd')), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', CHARTSHEET_TYPE, 'chartsheets/sheet1.xml'),
      ),
      workbook: workbookOf(sheetEntry('Data', 'rId1', 1) + sheetEntry('Chart', 'rId2', 2)),
    }),
    sheetName: 'Chart',
    expected: [['d']],
  },
  {
    name: 'a first sheet whose relationship is a chartsheet',
    file: oneSheet(row(1, inline('A1', 'd')), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', CHARTSHEET_TYPE, 'chartsheets/sheet1.xml'),
      ),
      workbook: workbookOf(sheetEntry('Chart', 'rId2', 2) + sheetEntry('Data', 'rId1', 1)),
    }),
    expected: CORRUPT,
  },
  {
    name: 'r:id="null" matches a worksheet relationship without Id',
    file: oneSheet(row(1, inline('A1', 'n')), {
      rels: relsOf(relationship(null, WORKSHEET_TYPE, 'worksheets/sheet1.xml')),
      workbook: workbookOf(sheetEntry('S', 'null', 1)),
    }),
    expected: [['n']],
  },
  {
    name: 'a sheet without r:id',
    file: oneSheet(row(1, inline('A1', 'n')), {
      workbook: workbookOf('<sheet name="S" sheetId="1"/>'),
    }),
    expected: CORRUPT,
  },
  {
    name: 'sheets without a name are skipped',
    file: () =>
      bookFile(
        [
          { name: 'A', rows: SHEET_A },
          { name: 'B', rows: SHEET_B },
        ],
        {
          workbook: workbookOf(
            '<sheet sheetId="1" r:id="rId1"/><sheet name="" sheetId="1" r:id="rId1"/>' +
              sheetEntry('B', 'rId2', 2),
          ),
        },
      ),
    expected: [['b']],
  },
  {
    name: 'prefixed workbook elements are found by local name',
    file: oneSheet(row(1, inline('A1', 'p')), {
      workbook:
        `${XML_DECLARATION}<x:workbook xmlns:x="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
        '<x:sheets><x:sheet name="P" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>',
    }),
    sheetName: 'P',
    expected: [['p']],
  },
  {
    name: 'a workbook without sheets',
    file: oneSheet(row(1, inline('A1', 'a')), {
      workbook: `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}"/>`,
    }),
    expected: CORRUPT,
  },
  {
    name: 'a workbook with an empty sheets list',
    file: oneSheet(row(1, inline('A1', 'a')), { workbook: workbookOf('') }),
    sheetName: 'Sheet1',
    expected: CORRUPT,
  },
];

const RELS_CASES: readonly ParityCase[] = [
  {
    name: 'a worksheet relationship that targets workbook.xml',
    file: oneSheet(row(1, inline('A1', 'a')), {
      rels: relsOf(relationship('rId1', WORKSHEET_TYPE, 'workbook.xml')),
    }),
    expected: CORRUPT,
  },
  {
    name: 'the sharedStrings relationship targets the selected worksheet',
    file: oneSheet(row(1, inline('A1', 'a'), '<c r="B1"><v>5</v></c>'), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', SHARED_STRINGS_TYPE, 'worksheets/sheet1.xml'),
      ),
    }),
    expected: [['a', 5]],
  },
  {
    name: 'the styles relationship targets the selected worksheet',
    file: oneSheet(row(1, inline('A1', 'a'), '<c r="B1"><v>5</v></c>'), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', STYLES_TYPE, 'worksheets/sheet1.xml'),
      ),
    }),
    expected: [['a', 5]],
  },
  {
    name: 'the styles relationship targets the selected worksheet, a styled cell breaks',
    file: oneSheet(row(1, inline('A1', 'a'), serial('B1', '5', '0')), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', STYLES_TYPE, 'worksheets/sheet1.xml'),
      ),
    }),
    expected: CORRUPT,
  },
  {
    name: 'the last styles relationship wins',
    file: oneSheet(row(1, serial('A1', '45000', '0')), {
      rels: relsOf(
        relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
        relationship('rId2', STYLES_TYPE, 'styles.xml'),
        relationship('rId3', STYLES_TYPE, 'plain-styles.xml'),
      ),
      extra: {
        [STYLES_PART]: `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}">${cellXfs('14')}</styleSheet>`,
        'xl/plain-styles.xml': `${XML_DECLARATION}<styleSheet xmlns="${SPREADSHEET_NS}">${cellXfs('0')}</styleSheet>`,
      },
    }),
    expected: [[45000]],
  },
  {
    name: 'a repeated worksheet Id: the later target wins',
    file: () =>
      bookFile(
        [
          { name: 'A', rows: SHEET_A },
          { name: 'B', rows: SHEET_B },
        ],
        {
          rels: relsOf(
            relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'),
            relationship('rId1', WORKSHEET_TYPE, 'worksheets/sheet2.xml'),
          ),
          workbook: workbookOf(sheetEntry('A', 'rId1', 1)),
        },
      ),
    expected: [['b']],
  },
  {
    // The reader keys worksheets in a plain object: assigning a string to its
    // `__proto__` is a no-op, so the sheet is never found.
    name: 'a worksheet relationship with Id "__proto__" is never found',
    file: oneSheet(row(1, inline('A1', 'a')), {
      rels: relsOf(relationship('__proto__', WORKSHEET_TYPE, 'worksheets/sheet1.xml')),
      workbook: workbookOf(sheetEntry('S', '__proto__', 1)),
    }),
    expected: CORRUPT,
  },
  {
    name: 'a worksheet relationship with Id "constructor" is found',
    file: oneSheet(row(1, inline('A1', 'a')), {
      rels: relsOf(relationship('constructor', WORKSHEET_TYPE, 'worksheets/sheet1.xml')),
      workbook: workbookOf(sheetEntry('S', 'constructor', 1)),
    }),
    expected: [['a']],
  },
  {
    name: 'an absolute worksheet target',
    file: oneSheet(row(1, inline('A1', 'a')), {
      rels: relsOf(relationship('rId1', WORKSHEET_TYPE, '/xl/worksheets/sheet1.xml')),
    }),
    expected: [['a']],
  },
];

const OTHER_CASES: readonly ParityCase[] = [
  {
    name: 'a lone surrogate reference reads as U+FFFD',
    file: oneSheet(row(1, inline('A1', 'a&#xD800;b'))),
    expected: [['a\uFFFDb']],
  },
  {
    name: 'a surrogate pair split by a comment reads as two U+FFFD',
    file: oneSheet(
      row(1, inline('A1', '&#xD83D;<!--c-->&#xDE00;'), '<c r="B1" t="s"><v>0</v></c>'),
      {
        sharedStrings: '<si><t>&#xD83D;<!--c-->&#xDE00;</t></si>',
      },
    ),
    expected: [['\uFFFD\uFFFD', '\uFFFD\uFFFD']],
  },
  {
    name: 'a surrogate pair written as two references stays a pair',
    file: oneSheet(row(1, inline('A1', '&#xD83D;&#xDE00;'))),
    expected: [['\uD83D\uDE00']],
  },
  {
    name: 'carriage returns and NEL written as references survive',
    file: oneSheet(row(1, inline('A1', 'a&#13;&#10;b&#x85;c'))),
    expected: [['a\r\nb\u0085c']],
  },
  {
    name: 'line and paragraph separators written as references survive',
    file: oneSheet(row(1, inline('A1', 'a&#x2028;b&#x2029;c'))),
    expected: [['a\u2028b\u2029c']],
  },
  {
    name: 'raw line and paragraph separators read as line feeds',
    file: oneSheet(row(1, inline('A1', 'a\u2028b\u2029c'))),
    expected: [['a\nb\nc']],
  },
  {
    name: 'divergence: style index "length"',
    file: oneSheet(row(1, serial('A1', '5', 'length')), { styles: DATE_STYLES }),
    expected: CORRUPT,
  },
  {
    name: 'divergence: style index "constructor"',
    file: oneSheet(row(1, serial('A1', '5', 'constructor')), { styles: DATE_STYLES }),
    expected: CORRUPT,
  },
];

const READER_PARITY_CASES: readonly ParityCase[] = [
  ...CELL_CASES,
  ...DATE_CASES,
  ...SHARED_STRING_CASES,
  ...GRID_CASES,
  ...SELECTION_CASES,
  ...RELS_CASES,
  ...OTHER_CASES,
];

// ---------------------------------------------------------------------------
// Assertions

function isFileError(e: unknown): e is SpreadsheetFileError {
  return e instanceof SpreadsheetFileError;
}

function readerOutcome(c: ParityCase): ParityOutcome {
  try {
    return readGrid(openUpload(c.file(), OPTS), { sheetName: c.sheetName, caps: CAPS });
  } catch (e) {
    if (isFileError(e)) return { error: e.code };
    throw e;
  }
}

/** [row, column] of every Date cell in `outcome`. */
function datePositions(outcome: ParityOutcome): Array<readonly [number, number]> {
  if (!Array.isArray(outcome)) return [];
  const positions: Array<readonly [number, number]> = [];
  outcome.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      if (cell instanceof Date) positions.push([r, c]);
    });
  });
  return positions;
}

function cellAt(outcome: ParityOutcome, r: number, c: number): unknown {
  return Array.isArray(outcome) ? outcome[r]?.[c] : undefined;
}

describe('reader parity cases', () => {
  it.each(READER_PARITY_CASES)('$name', (c) => {
    const outcome = readerOutcome(c);

    expect(outcome).toEqual(c.expected);
    for (const [r, col] of datePositions(c.expected)) {
      expect(cellAt(outcome, r, col)).toBeInstanceOf(Date);
    }
  });
});

describe('the eight fixtures through the own reader', () => {
  it.each(FIXTURE_PINS)('$file', (pin) => {
    const grid = readGrid(openUpload(readFixture(pin.file), OPTS), {
      sheetName: pin.sheetName,
      caps: CAPS,
    });

    expect(gridSha256(grid)).toBe(pin.gridSha256);
  });
});
