import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { FIXTURE_PINS, readFixture } from '../../tests/helpers/fixture-pins';
import { MAIN_NAMESPACE, sheet } from '../../tests/helpers/patch-helpers';
import { expectWithinBudget, LINEAR_BUDGET_MS } from '../../tests/helpers/timing';
import { SPREADSHEET_MAIN_NAMESPACES } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { cellKey, columnLetters } from '../sheet-meta';
import { parsePart } from '../xml-dom';
import { resolveWorksheetPartPaths } from '../workbook-parts';
import { MALFORMED_SHEET_REASONS, UNSUPPORTED_ENCODING_REASONS } from './reasons';
import { cellKeysOf, indexWorksheet } from './sheet-index';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Built from code units so the source file stays ASCII.
const C1_CONTROL = String.fromCharCode(0x80);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const U_DIAERESIS = String.fromCharCode(0xfc);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
// Never valid in UTF-8.
const INVALID_UTF8_BYTE = 0xff;

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const ROW_A1 = '<row r="1"><c r="A1"/></row>';
const A1_KEY = cellKey(1, 1);
const EMPTY_SHEET = `${DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}"><sheetData/></worksheet>`;
const EMPTY_PREFIXED_SHEET = `${DECLARATION}<x:worksheet xmlns:x="${MAIN_NAMESPACE}"><x:sheetData/></x:worksheet>`;
// The main namespace with its first letter written as a character reference: the
// reader decodes it to the main namespace, while its raw bytes are another string.
const MAIN_NAMESPACE_WITH_REFERENCE = `&#${MAIN_NAMESPACE.charCodeAt(0)};${MAIN_NAMESPACE.slice(1)}`;

// Cells of each fixture's worksheet part, in FIXTURE_PINS order.
const FIXTURE_CELL_COUNTS: readonly number[] = [1960, 1264, 1232, 1054, 45, 2460, 1368, 966];

const COMMENTED_ROWS = 200_000;
const WIDE_ROWS = 20_001;
const WIDE_COLUMNS = 64;
const NESTED_ELEMENTS = 100_000;
const ROOT_DECLARATIONS = 5_000;
const DECLARING_ROWS = 20_000;
const UNCLOSED_ROWS = 200_000;
const LINEAR_TEST_TIMEOUT_MS = 120_000;

function sheetText(body: string, rootAttributes?: string): string {
  return decoder.decode(sheet(body, rootAttributes));
}

/** `sheet(body)` with its XML declaration replaced by `declaration`. */
function withDeclaration(declaration: string, body = ROW_A1): Uint8Array {
  const part = sheetText(body);
  if (!part.startsWith(DECLARATION)) throw new Error('sheet() starts with another declaration');
  return encoder.encode(declaration + part.slice(DECLARATION.length));
}

/** `sheet(body)` with the first `from` replaced by `to`. */
function editedSheet(body: string, from: string, to: string, rootAttributes?: string): Uint8Array {
  return encoder.encode(sheetText(body, rootAttributes).replace(from, to));
}

function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (error) {
    if (error instanceof SpreadsheetFileError) return error;
    throw error;
  }
  throw new Error('Expected a SpreadsheetFileError');
}

function expectMalformed(bytes: Uint8Array, reason: string): void {
  const error = fileErrorOf(() => indexWorksheet(bytes));
  expect(error.code).toBe('MALFORMED_SHEET');
  expect(error.meta).toEqual({ reason, offset: expect.any(Number) });
}

function expectOneCellA1(bytes: Uint8Array): void {
  const index = indexWorksheet(bytes);
  expect(index.rowNumber).toEqual([1]);
  expect(cellKeysOf(index)).toEqual([A1_KEY]);
}

/** Runs `work` and asserts it stayed within the linear budget (enforced in CI). */
function timed<T>(work: () => T): T {
  const started = performance.now();
  const result = work();
  expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
  return result;
}

describe('indexWorksheet: offsets', () => {
  it('records rows and cells as byte offsets into the part', () => {
    const bytes = sheet('<row r="1"><c r="A1"/><c r="C1"><v>1</v></c></row><row r="3"/>');
    const index = indexWorksheet(bytes);

    expect(index.bytes).toBe(bytes);
    expect(index.rowNumber).toEqual([1, 3]);
    expect(index.rowFirstCell).toEqual([0, 2, 2]);
    expect(index.cellColumn).toEqual([1, 3]);
    expect(decoder.decode(bytes.subarray(index.cellStart[1], index.cellEnd[1]))).toBe(
      '<c r="C1"><v>1</v></c>',
    );
    expect(index.cellTagEnd[0]).toBe(index.cellEnd[0]);
    expect(decoder.decode(bytes.subarray(index.rowStart[0], index.rowTagEnd[0]))).toBe(
      '<row r="1">',
    );
    expect(
      decoder.decode(bytes.subarray(index.rowStart[0], index.rowEnd[0])).endsWith('</row>'),
    ).toBe(true);
    expect(index.rowEnd[1]).toBe(index.rowTagEnd[1]);
    expect(cellKeysOf(index)).toEqual([1025, 1027]);
  });
});

describe('indexWorksheet: accepted shapes', () => {
  it('accepts every element prefixed, the prefix bound to the main namespace', () => {
    expectOneCellA1(
      encoder.encode(
        `${DECLARATION}<x:worksheet xmlns:x="${MAIN_NAMESPACE}"><x:sheetData><x:row r="1">` +
          '<x:c r="A1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>',
      ),
    );
  });

  it.each(SPREADSHEET_MAIN_NAMESPACES)('accepts the main namespace %s', (namespace) => {
    expectOneCellA1(sheet(ROW_A1, `xmlns="${namespace}"`));
  });

  it('accepts the default namespace declared on sheetData instead of the root', () => {
    expectOneCellA1(
      editedSheet(ROW_A1, '<sheetData>', `<sheetData xmlns="${MAIN_NAMESPACE}">`, ''),
    );
  });

  it.each([EMPTY_SHEET, EMPTY_PREFIXED_SHEET])('accepts an empty sheetData: %s', (part) => {
    const index = indexWorksheet(encoder.encode(part));
    expect(index.rowNumber).toEqual([]);
    expect(index.rowFirstCell).toEqual([0]);
  });

  it('accepts a formatted empty row far below the data', () => {
    const index = indexWorksheet(sheet(`${ROW_A1}<row r="1048576"/>`));
    expect(index.rowNumber).toEqual([1, 1_048_576]);
    expect(cellKeysOf(index)).toEqual([A1_KEY]);
  });

  it('skips a byte order mark before the declaration', () => {
    expectOneCellA1(encoder.encode(BYTE_ORDER_MARK + sheetText(ROW_A1)));
  });

  it('accepts a declaration without an encoding', () => {
    expectOneCellA1(withDeclaration('<?xml version="1.0" ?>'));
  });

  it('accepts a part without a declaration', () => {
    expectOneCellA1(withDeclaration(''));
  });

  it('accepts the encoding name in lower case', () => {
    expectOneCellA1(withDeclaration('<?xml version="1.0" encoding="utf-8"?>'));
  });
});

describe('indexWorksheet: opaque and skipped content', () => {
  it.each<[string, string]>([
    [
      'comments, CDATA and processing instructions',
      '<!-- <row r="9"><c r="A9"/></row> --><row r="1"><![CDATA[<c r="B1"/>]]>' +
        '<?p <c r="C1"/> ?><c r="A1"/></row>',
    ],
    [
      'a nested row and an extLst inside the row',
      '<row r="1"><row r="2"><c r="A2"/></row><c r="A1"/><extLst><ext><c r="Z1"/></ext></extLst></row>',
    ],
    [
      'a row inside another child of sheetData',
      '<foo><row r="7"/></foo><row r="1"><c r="A1"/></row>',
    ],
  ])('indexes one row and one cell past %s', (_label, body) => {
    expectOneCellA1(sheet(body));
  });

  it('accepts comments and processing instructions before and after the root', () => {
    const part = sheetText(ROW_A1);
    const root = part.slice(DECLARATION.length);
    expectOneCellA1(encoder.encode(`${DECLARATION}<!-- a -->\n<?p q?>${root}\n<!-- b --><?p r?>`));
  });
});

describe('indexWorksheet: rejected row references', () => {
  it.each([
    '<row><c r="A1"/></row>',
    '<row r="01"/>',
    '<row r="0"/>',
    '<row r="2"/><row r="2"/>',
    '<row r="3"/><row r="2"/>',
    '<row r="&#49;"/>',
    '<row R="1"/>',
    '<row r="1" r="2"/>',
    '<row r="1" x:r="2" xmlns:x="urn:other"/>',
  ])('row-ref: %s', (body) => {
    expectMalformed(sheet(body), MALFORMED_SHEET_REASONS.ROW_REF);
  });
});

describe('indexWorksheet: rejected cell references', () => {
  it.each([
    '<row r="1"><c/></row>',
    '<row r="1"><c r="a1"/></row>',
    '<row r="1"><c r="A01"/></row>',
    '<row r="2"><c r="A3"/></row>',
    '<row r="1"><c r="B1"/><c r="A1"/></row>',
    '<row r="1"><c r="A1"/><c r="A1"/></row>',
    '<row r="1"><c r="&#65;1"/></row>',
    // Column 257, one past ABSOLUTE_MAX_COLS.
    '<row r="1"><c r="IW1"/></row>',
    '<row r="1"><c r="A1" x:r="B1" xmlns:x="urn:other"/></row>',
  ])('cell-ref: %s', (body) => {
    expectMalformed(sheet(body), MALFORMED_SHEET_REASONS.CELL_REF);
  });
});

describe('indexWorksheet: rejected namespaces', () => {
  it.each<[string, Uint8Array]>([
    ['a root with no default namespace', sheet(ROW_A1, '')],
    ['a row in a foreign prefixed namespace', sheet('<x:row xmlns:x="urn:other" r="1"/>')],
    ['a row in a foreign default namespace', sheet('<row xmlns="urn:other" r="1"/>')],
    [
      'a cell in a foreign default namespace',
      sheet('<row r="1"><c xmlns="urn:other" r="A1"/></row>'),
    ],
    ['a row with an unbound prefix', sheet('<y:row r="1"/>')],
    [
      'a root namespace followed by a character reference',
      sheet(ROW_A1, `xmlns="${MAIN_NAMESPACE}&#32;"`),
    ],
    [
      'a root namespace with a letter written as a character reference',
      sheet(ROW_A1, `xmlns="${MAIN_NAMESPACE_WITH_REFERENCE}"`),
    ],
    [
      'a row prefix bound with a letter written as a character reference',
      sheet(`<x:row xmlns:x="${MAIN_NAMESPACE_WITH_REFERENCE}" r="1"/>`),
    ],
    ['a row that undeclares the default namespace', sheet('<row xmlns="" r="1"><c r="A1"/></row>')],
    [
      'a cell that undeclares the default namespace',
      sheet('<row r="1"><c xmlns="" r="A1"/></row>'),
    ],
    [
      'a sheetData that undeclares the default namespace',
      editedSheet(ROW_A1, '<sheetData>', '<sheetData xmlns="">'),
    ],
    ['the reserved xml prefix', sheet('<xml:row r="1"><xml:c r="A1"/></xml:row>')],
    ['the reserved xmlns prefix', sheet('<xmlns:row r="1"/>')],
    [
      'one prefix declared twice on a row',
      sheet(`<x:row xmlns:x="${MAIN_NAMESPACE}" xmlns:x="${MAIN_NAMESPACE}" r="1"/>`),
    ],
  ])('namespace: %s', (_label, bytes) => {
    expectMalformed(bytes, MALFORMED_SHEET_REASONS.NAMESPACE);
  });
});

describe('indexWorksheet: rejected structure', () => {
  const part = sheetText(ROW_A1);

  it.each<[string, Uint8Array]>([
    ['a self-closing root', encoder.encode(`${DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}"/>`)],
    [
      'a root without sheetData',
      encoder.encode(
        `${DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}"><dimension ref="A1"/></worksheet>`,
      ),
    ],
    ['two sheetData children', sheet('<row r="1"/></sheetData><sheetData><row r="2"/>')],
    ['text after the root end tag', encoder.encode(`${part}x`)],
    ['input cut inside sheetData', encoder.encode(part.slice(0, part.indexOf('</sheetData>')))],
    [
      'an XML declaration as a child of the root',
      editedSheet(ROW_A1, '<sheetData>', '<?xml version="1.0"?><sheetData>'),
    ],
    ['no root element', encoder.encode(DECLARATION)],
    ['an end tag before the root', encoder.encode(`${DECLARATION}</worksheet>`)],
    // xmldom, as the reader configures it, silently accepts one extra end tag that
    // repeats the root's name.
    ['an extra root end tag', encoder.encode(`${EMPTY_SHEET}</worksheet>`)],
    ['an extra prefixed root end tag', encoder.encode(`${EMPTY_PREFIXED_SHEET}</x:worksheet>`)],
    ['an upper-case XML declaration', withDeclaration('<?XML version="1.0"?>')],
  ])('structure: %s', (_label, bytes) => {
    expectMalformed(bytes, MALFORMED_SHEET_REASONS.STRUCTURE);
  });
});

// The index counts depth and does not compare end-tag names; the reader's strict
// parse, which always runs first, refuses every such part. Pinned here so a laxer
// xmldom fails this file instead of letting the index see another tree.
describe('parsePart refuses what the index does not check', () => {
  it.each<[string, string]>([
    ['an end tag naming another open element', '<row r="1"><c r="A1"></row></c></row>'],
    ['crossed end tags inside a cell', '<row r="1"><c r="A1"><v>1</c></v></row>'],
    ['an end tag in another case', '<row r="1"><c r="A1"></C></row>'],
    ['an end tag with another prefix', '<row r="1"><c r="A1"></x:c></row>'],
    ['an attribute given twice', '<row r="1"><c r="A1" s="1" s="2"/></row>'],
  ])('%s', (_label, body) => {
    expect(() => parsePart('xl/worksheets/sheet1.xml', sheetText(body))).toThrow(
      SpreadsheetFileError,
    );
  });

  it('refuses an XML declaration that is not at the very start', () => {
    expect(() => parsePart('xl/worksheets/sheet1.xml', `\n${sheetText(ROW_A1)}`)).toThrow(
      SpreadsheetFileError,
    );
  });
});

describe('indexWorksheet: rejected markup', () => {
  type Shape = (name: string, ref: string) => string;

  // Each shape is one xmldom accepts leniently; every one must be refused as a row
  // and as a cell. Control and non-ASCII characters are code-unit constants.
  const tagWhitespaceImpostors: ReadonlyArray<readonly [string, string]> = [
    ['U+0080', C1_CONTROL],
    ['a form feed', '\f'],
    ['U+0001', '\u0001'],
    ['NUL', '\u0000'],
    ['a vertical tab', '\u000B'],
    ['U+2028', LINE_SEPARATOR],
  ];
  const shapes: ReadonlyArray<readonly [string, Shape]> = [
    ['an unquoted value', (name, ref) => `<${name} r=${ref}/>`],
    ['no space between attributes', (name, ref) => `<${name} r="${ref}"s="1"/>`],
    ['whitespace between "/" and ">"', (name, ref) => `<${name} r="${ref}" / >`],
    ...tagWhitespaceImpostors.map(([label, impostor]): readonly [string, Shape] => [
      `${label} after the name`,
      (name, ref) => `<${name}${impostor}r="${ref}"/>`,
    ]),
    ['a valueless attribute', (name, ref) => `<${name} r="${ref}" x/>`],
    ['a non-ASCII attribute name', (name, ref) => `<${name} r="${ref}" ${U_DIAERESIS}="1"/>`],
  ];
  const cases: Array<[string, Uint8Array]> = shapes.flatMap(
    ([label, shape]): Array<[string, Uint8Array]> => [
      [`${label}, on a row`, sheet(shape('row', '1'))],
      [`${label}, on a cell`, sheet(`<row r="1">${shape('c', 'A1')}</row>`)],
    ],
  );

  it.each<[string, Uint8Array]>([
    ...cases,
    [
      'a non-ASCII prefix bound to the main namespace',
      sheet(`<${U_DIAERESIS}:row xmlns:${U_DIAERESIS}="${MAIN_NAMESPACE}" r="1"/>`),
    ],
    [
      'a non-ASCII element name the index would skip',
      sheet(`<row r="1"><c r="A1"/><${U_DIAERESIS} r="B1"/></row>`),
    ],
    [
      'an unquoted value inside a skipped subtree',
      sheet('<row r="1"><c r="A1"><v a=b>1</v></c></row>'),
    ],
  ])('markup: %s', (_label, bytes) => {
    expectMalformed(bytes, MALFORMED_SHEET_REASONS.MARKUP);
  });
});

describe('indexWorksheet: encoding', () => {
  it.each([
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    `<?xml version="1.0" encoding='UTF-16'?>`,
    '<?xml version="1.0" encoding="UTF-8" encoding="ISO-8859-1"?>',
  ])('refuses the declaration %s', (declaration) => {
    const error = fileErrorOf(() => indexWorksheet(withDeclaration(declaration)));
    expect(error.code).toBe('UNSUPPORTED_ENCODING');
    expect(error.meta).toEqual({ reason: UNSUPPORTED_ENCODING_REASONS.DECLARATION });
  });

  it('refuses a part whose bytes are not UTF-8', () => {
    const bytes = sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Q</t></is></c></row>');
    expect(cellKeysOf(indexWorksheet(bytes))).toEqual([A1_KEY]);
    bytes[decoder.decode(bytes).indexOf('>Q<') + 1] = INVALID_UTF8_BYTE;

    const error = fileErrorOf(() => indexWorksheet(bytes));
    expect(error.code).toBe('UNSUPPORTED_ENCODING');
    expect(error.meta).toEqual({ reason: UNSUPPORTED_ENCODING_REASONS.BYTES });
  });
});

describe('indexWorksheet: real files', () => {
  it('has a cell count for every pinned fixture', () => {
    expect(FIXTURE_CELL_COUNTS).toHaveLength(FIXTURE_PINS.length);
  });

  it.each(
    FIXTURE_PINS.map((pin, position) => ({
      file: pin.file,
      rows: pin.rows,
      cells: FIXTURE_CELL_COUNTS[position],
    })),
  )('$file', ({ file, rows, cells }) => {
    const entries = unzipSync(new Uint8Array(readFixture(file)));
    const [part, ...others] = resolveWorksheetPartPaths(entries);
    expect(others).toEqual([]);
    const bytes = part === undefined ? undefined : entries[part];
    if (bytes === undefined) throw new Error(`${file}: no worksheet part`);

    const index = indexWorksheet(bytes);
    expect(index.rowNumber).toHaveLength(rows);
    expect(index.cellColumn.length).toBe(cells);
  });
});

describe('indexWorksheet: linear time', { timeout: LINEAR_TEST_TIMEOUT_MS }, () => {
  it('skips 200 000 rows inside a comment', () => {
    const bytes = sheet(`<!--${'<row r="1">'.repeat(COMMENTED_ROWS)}-->${ROW_A1}`);
    const index = timed(() => indexWorksheet(bytes));
    expect(index.rowNumber).toEqual([1]);
    expect(cellKeysOf(index)).toEqual([A1_KEY]);
  });

  it('indexes 20 001 rows of 64 cells', () => {
    const letters = Array.from({ length: WIDE_COLUMNS }, (_, column) => columnLetters(column + 1));
    const rows = Array.from({ length: WIDE_ROWS }, (_, position) => {
      const row = position + 1;
      return `<row r="${row}">${letters.map((column) => `<c r="${column}${row}"/>`).join('')}</row>`;
    });
    const bytes = sheet(rows.join(''));
    const index = timed(() => indexWorksheet(bytes));
    expect(index.rowNumber).toHaveLength(WIDE_ROWS);
    expect(index.cellColumn).toHaveLength(WIDE_ROWS * WIDE_COLUMNS);
  });

  it('skips 100 000 nested elements inside one cell by the depth counter', () => {
    const nested = '<a>'.repeat(NESTED_ELEMENTS) + '</a>'.repeat(NESTED_ELEMENTS);
    const bytes = sheet(`<row r="1"><c r="A1">${nested}</c></row>`);
    const index = timed(() => indexWorksheet(bytes));
    expect(cellKeysOf(index)).toEqual([A1_KEY]);
    expect(decoder.decode(bytes.subarray(index.cellEnd[0])).startsWith('</row>')).toBe(true);
  });

  it('resolves namespaces under 5 000 root declarations and 20 000 declaring rows', () => {
    const rootDeclarations = Array.from(
      { length: ROOT_DECLARATIONS },
      (_, position) => ` xmlns:p${position}="urn:p${position}"`,
    ).join('');
    const rows = Array.from(
      { length: DECLARING_ROWS },
      (_, position) =>
        `<row r="${position + 1}" xmlns:q${position}="urn:q${position}"><c r="A${position + 1}"/></row>`,
    ).join('');
    const bytes = sheet(rows, `xmlns="${MAIN_NAMESPACE}"${rootDeclarations}`);
    const index = timed(() => indexWorksheet(bytes));
    expect(index.rowNumber).toHaveLength(DECLARING_ROWS);
    expect(index.cellColumn).toHaveLength(DECLARING_ROWS);
  });

  it('refuses 200 000 rows that never close, promptly', () => {
    const body = Array.from(
      { length: UNCLOSED_ROWS },
      (_, position) => `<row r="${position + 1}">`,
    );
    const bytes = sheet(body.join(''));
    const error = timed(() => fileErrorOf(() => indexWorksheet(bytes)));
    expect(error.code).toBe('MALFORMED_SHEET');
    expect(error.meta.reason).toBe(MALFORMED_SHEET_REASONS.STRUCTURE);
  });
});
