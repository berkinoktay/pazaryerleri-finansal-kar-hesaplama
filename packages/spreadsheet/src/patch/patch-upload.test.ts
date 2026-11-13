import { createHash } from 'node:crypto';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../../tests/helpers/errors';
import { pinOf, readFixture } from '../../tests/helpers/fixture-pins';
import { clear, MAIN_NAMESPACE, num, text } from '../../tests/helpers/patch-helpers';
import { BOUNDED_INFLATE_BUDGET_MS, expectWithinBudget } from '../../tests/helpers/timing';
import {
  hiddenEntryArchive,
  hiddenTileArchive,
  type HiddenTileKind,
  rawSegment,
  sizeFlipArchive,
  swallowedEntryArchive,
  unsignedDescriptorArchive,
  zip64SkipArchive,
  type Zip64SkipCopy,
} from '../../tests/helpers/workbooks';
import {
  ABSOLUTE_MAX_BYTES,
  MAX_PATCH_OUTPUT_TOTAL_BYTES,
  MAX_PATCH_OUTPUTS,
  MAX_PATCH_TEXT_LENGTH,
} from '../constants';
import type { SpreadsheetFileErrorCode } from '../errors';
import type { SheetData } from '../grid-types';
import { openUpload } from '../guards';
import { readSheet, readUploadGrid } from '../read-grid';
import { resolveReadOptions, type ReadGridOptions } from '../read-options';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import { patchFixture, type PatchFixtureOptions } from '../testing/patch-fixture';
import { resolvePatchRequest, type CellPatch, type ResolvedPatchRequest } from './patch-request';
import { assertOutputBudget, assertSameCells, assertSameViews, patchUpload } from './patch-upload';
import { readZipLayout } from './raw-zip';
import {
  MALFORMED_SHEET_REASONS,
  PATCH_LIMIT_REASONS,
  UNSUPPORTED_ENCODING_REASONS,
  ZIP_REJECT_REASONS,
} from './reasons';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CALC_CHAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml';

const VML_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.vmlDrawing';
const PNG_CONTENT_TYPE = 'image/png';

const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SECOND_SHEET_PART = 'xl/worksheets/sheet2.xml';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const RELS_PART = 'xl/_rels/workbook.xml.rels';
const CONTENT_TYPES_PART = '[Content_Types].xml';
const CALC_CHAIN_PART = 'xl/calcChain.xml';
const STYLES_PART = 'xl/styles.xml';
const APP_PROPERTIES_PART = 'docProps/app.xml';
const BLOB_PART = 'xl/media/blob.bin';
const DISCOUNT_FIXTURE = 'trendyol-discount-products.xlsx';
// Bytes of a part other relationships use; the tests only compare them.
const SHARED_PART_BYTES = 'not a calcChain';

const DEFAULT_READ = resolveReadOptions({});
const GUARD_OPTS = {
  rowCap: DEFAULT_READ.rowCap,
  colCap: DEFAULT_READ.colCap,
  maxBytes: DEFAULT_READ.maxBytes,
} as const;
const TILE_KINDS: readonly HiddenTileKind[] = ['other-sheet', 'bomb', 'same-sheet'];
const ZIP64_SKIP_COPIES: readonly Zip64SkipCopy[] = ['record-comment', 'trailing-bytes'];
// Unsigned data descriptors: the crc and both sizes in 32 bits, or in 64.
const UNSIGNED_DESCRIPTOR_32_LENGTH = 12;
const UNSIGNED_DESCRIPTOR_64_LENGTH = 20;
const ONE_CELL = '<row r="1"><c r="A1"><v>7</v></c></row>';
const TWO_ROWS = '<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>';
const INERT_FORMULA_TEXT = "=cmd|' /C calc'!A0";
// A date serial the kept date style turns into a Date.
const DATE_SERIAL = '45000';
// fflate's level for a stored (not deflated) entry.
const STORED_LEVEL = 0;
const SHA256_HEX_LENGTH = 64;
const MIB = 1024 * 1024;
// An upload this far under the read byte cap: a long incompressible text adds more.
const READ_CAP_MARGIN = 1024;
// About 16.5 MiB per output, under a raised read cap: seven outputs fit in
// MAX_PATCH_OUTPUT_TOTAL_BYTES (128 MiB), eight do not.
const LARGE_UPLOAD_BYTES = (33 * MIB) / 2;
const LARGE_READ_MAX_BYTES = 20 * MIB;

/** A worksheet part in the main namespace whose sheetData holds `body`; `after` follows the sheetData. */
function worksheet(body: string, after = ''): string {
  return `${XML_DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}"><sheetData>${body}</sheetData>${after}</worksheet>`;
}

/** A one-sheet workbook whose worksheet part is `xml`. */
function bookOf(xml: string, extraEntries: Readonly<Record<string, string>> = {}): Buffer {
  return buildXlsxFixture([{ name: 'Sheet1', xml }], extraEntries);
}

function book(body: string): Buffer {
  return bookOf(worksheet(body));
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${OFFICE_RELATIONSHIPS_NS}/${type}" Target="${target}"/>`;
}

function relsOf(...relationships: readonly string[]): string {
  return `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">${relationships.join('')}</Relationships>`;
}

/** A content types part: the rels and xml Defaults, then `defaults`, then `children`. */
function contentTypesOf(children: readonly string[], defaults: readonly string[] = []): string {
  return (
    `${XML_DECLARATION}<Types xmlns="${CONTENT_TYPES_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `${defaults.join('')}${children.join('')}</Types>`
  );
}

/** `file` plus a stored entry of zero bytes, sized so that the archive is `length` bytes long. */
function withStoredBlob(file: Buffer, length: number): Buffer {
  const entries = unzipSync(file);
  const empty = zipSync({ ...entries, [BLOB_PART]: [new Uint8Array(0), { level: STORED_LEVEL }] });
  const blob = new Uint8Array(length - empty.length);
  return Buffer.from(zipSync({ ...entries, [BLOB_PART]: [blob, { level: STORED_LEVEL }] }));
}

/** `length` hex digits, sha256 digests of counters: text deflate cannot shrink much. */
function hexText(length: number): string {
  return Array.from({ length: Math.ceil(length / SHA256_HEX_LENGTH) }, (_, counter) =>
    createHash('sha256').update(String(counter)).digest('hex'),
  )
    .join('')
    .slice(0, length);
}

function readBack(file: Uint8Array, options: ReadGridOptions = {}): SheetData {
  return readUploadGrid(file, resolveReadOptions(options));
}

function expectFileError(
  run: () => unknown,
  code: SpreadsheetFileErrorCode,
  meta: Record<string, unknown>,
): void {
  const error = fileErrorOf(run);
  expect(error.code).toBe(code);
  expect(error.meta).toEqual(meta);
}

function expectReason(run: () => unknown, code: SpreadsheetFileErrorCode, reason: string): void {
  const error = fileErrorOf(run);
  expect(error.code).toBe(code);
  expect(error.meta).toMatchObject({ reason });
}

/** Local header, data and data descriptor of the entry named `name`. */
function segmentNamed(file: Uint8Array, name: string): Buffer {
  const entry = readZipLayout(file).entries.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`no entry named ${name}`);
  return rawSegment(file, entry);
}

/** Whether the entry named `name` has the same raw segment in both archives. */
function sameSegment(out: Uint8Array, source: Uint8Array, name: string): boolean {
  return segmentNamed(out, name).equals(segmentNamed(source, name));
}

function entryText(file: Uint8Array, name: string): string {
  const bytes = unzipSync(file)[name];
  if (bytes === undefined) throw new Error(`no entry named ${name}`);
  return strFromU8(bytes);
}

// Each body is one the reader reads (the grid shown) and the patcher refuses (Review
// Focus 1): xmldom accepts it in strict mode, the strict lexer and the index do not.
const READER_ACCEPTS_PATCHER_REFUSES: readonly (readonly [
  label: string,
  body: string,
  grid: SheetData,
  reason: string,
])[] = [
  [
    'an unquoted attribute value',
    '<row r="1"><c r=A1><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'no whitespace between attributes',
    '<row r="1"><c r="A1"t="n"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a space inside an empty-element close',
    '<row r="1" / ><row r="2"><c r="A2"><v>7</v></c></row>',
    [[null], [7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'U+0080 as tag whitespace',
    '<row\u0080r="1"><c r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a form feed as tag whitespace',
    '<row r="1"><c\fr="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'U+0001 as tag whitespace',
    '<row r="1"><c\u0001r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'NUL as tag whitespace',
    '<row r="1"><c\u0000r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a vertical tab as tag whitespace',
    '<row r="1"><c\u000Br="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'U+2028 as tag whitespace',
    '<row r="1"><c\u2028r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a valueless attribute',
    '<row r="1"><c r="A1" x><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a non-ASCII attribute name',
    '<row r="1"><c r="A1" \u00FC="1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a non-ASCII element name',
    '<row r="1"><c r="A1"><v>7</v></c><\u00FC r="B1"/></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a non-ASCII prefix bound to the main namespace',
    `<\u00FC:row xmlns:\u00FC="${MAIN_NAMESPACE}" r="1"><\u00FC:c r="A1"><\u00FC:v>7</\u00FC:v></\u00FC:c></\u00FC:row>`,
    [[7]],
    MALFORMED_SHEET_REASONS.MARKUP,
  ],
  [
    'a character reference in a cell reference',
    '<row r="1"><c r="&#65;1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.CELL_REF,
  ],
  [
    'a row in a foreign namespace',
    '<x:row xmlns:x="urn:other" r="1"><x:c r="A1"><x:v>7</x:v></x:c></x:row>',
    [[7]],
    MALFORMED_SHEET_REASONS.NAMESPACE,
  ],
  [
    'a row under the xml prefix',
    '<xml:row r="1"><xml:c r="A1"><xml:v>7</xml:v></xml:c></xml:row>',
    [[7]],
    MALFORMED_SHEET_REASONS.NAMESPACE,
  ],
  [
    'a row that undeclares the default namespace',
    '<row xmlns="" r="1"><c r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.NAMESPACE,
  ],
  [
    'a repeated row',
    '<row r="1"><c r="A1"><v>7</v></c></row><row r="1"><c r="B1"><v>8</v></c></row>',
    [[7, 8]],
    MALFORMED_SHEET_REASONS.ROW_REF,
  ],
  [
    'a cell whose row digits are not its row',
    '<row r="5"><c r="A1"><v>7</v></c></row>',
    [[7]],
    MALFORMED_SHEET_REASONS.CELL_REF,
  ],
  ['a row without r', '<row><c r="A1"><v>7</v></c></row>', [[7]], MALFORMED_SHEET_REASONS.ROW_REF],
];

describe('patchUpload: the reader accepts, the patcher refuses', () => {
  it.each(READER_ACCEPTS_PATCHER_REFUSES)('%s', (_, body, grid, reason) => {
    const file = book(body);
    expect(readBack(file)).toEqual(grid);
    expectReason(() => patchFixture(file, [num(1, 0, '1')]), 'MALFORMED_SHEET', reason);
  });

  it.each<[string, string, SpreadsheetFileErrorCode, string]>([
    [
      'a declaration of another encoding',
      `<?xml version="1.0" encoding="ISO-8859-1"?><worksheet xmlns="${MAIN_NAMESPACE}"><sheetData>${ONE_CELL}</sheetData></worksheet>`,
      'UNSUPPORTED_ENCODING',
      UNSUPPORTED_ENCODING_REASONS.DECLARATION,
    ],
    [
      'a second sheetData holding another value',
      worksheet(ONE_CELL, '<sheetData><row r="1"><c r="A1"><v>8</v></c></row></sheetData>'),
      'MALFORMED_SHEET',
      MALFORMED_SHEET_REASONS.STRUCTURE,
    ],
  ])('the whole part: %s', (_, xml, code, reason) => {
    const file = bookOf(xml);
    expect(readBack(file)).toEqual([[7]]);
    expectReason(() => patchFixture(file, [num(1, 0, '1')]), code, reason);
  });

  it('runs the reader before the index: crossed end tags are the reader error', () => {
    // The index never compares end tag names, so only the reader's strict parse, which
    // runs first, refuses this part.
    const file = book('<row r="1"><c r="A1"><v>1</c></v></row>');
    const readerError = fileErrorOf(() => readBack(file));
    const patchError = fileErrorOf(() => patchFixture(file, [num(1, 0, '9')]));
    expect(patchError.code).toBe(readerError.code);
    expect(patchError.code).not.toBe('MALFORMED_SHEET');
    expect(patchError.message).toBe(readerError.message);
    expect(patchError.meta).toEqual(readerError.meta);
  });
});

describe('patchUpload: the reader and the patcher agree', () => {
  it.each<[string, string]>([
    [
      'a comment that holds a row',
      worksheet('<!--<row r="1"><c r="A1"><v>0</v></c></row>-->' + ONE_CELL),
    ],
    [
      'a CDATA section that holds a cell',
      worksheet('<row r="1"><![CDATA[<c r="B1"/>]]><c r="A1"><v>7</v></c></row>'),
    ],
    [
      'a processing instruction that holds a cell',
      worksheet('<row r="1"><?p <c r="B1"/> ?><c r="A1"><v>7</v></c></row>'),
    ],
    ['single-quoted attributes', worksheet("<row r='1'><c r='A1'><v>7</v></c></row>")],
    [
      'every element prefixed and bound to the main namespace',
      worksheetXml([[7]], { prefix: 'x' }),
    ],
  ])('%s', (_, xml) => {
    const out = patchFixture(bookOf(xml), [num(1, 0, '9')]);
    expect(readBack(out)).toEqual([[9]]);
  });
});

describe('assertSameCells', () => {
  it.each<[readonly number[], readonly number[]]>([
    [[1025, 1026], [1025]],
    [
      [1025, 1026],
      [1025, 1027],
    ],
  ])('refuses %j against %j', (readerKeys, indexKeys) => {
    expectFileError(() => assertSameCells(readerKeys, indexKeys), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.READER_MISMATCH,
      readerCells: readerKeys.length,
      indexCells: indexKeys.length,
    });
  });

  it('passes equal lists', () => {
    expect(() => assertSameCells([1025, 2049], [1025, 2049])).not.toThrow();
  });
});

describe('assertSameViews', () => {
  const file = book(ONE_CELL);
  const parts = openUpload(file, GUARD_OPTS);
  const layout = readZipLayout(file);
  const sheetBytes = parts[SHEET_PART];
  if (sheetBytes === undefined) throw new Error(`no part named ${SHEET_PART}`);

  it('passes the parts the gate read', () => {
    expect(() => assertSameViews(file, layout, parts)).not.toThrow();
  });

  it.each<[string, Uint8Array]>([
    ['one byte changed', Uint8Array.from(sheetBytes, (byte, at) => (at === 0 ? byte ^ 1 : byte))],
    ['one byte appended', Uint8Array.from([...sheetBytes, 0x20])],
  ])('refuses a worksheet part with %s', (_, changed) => {
    expectFileError(
      () => assertSameViews(file, layout, { ...parts, [SHEET_PART]: changed }),
      'CORRUPT_FILE',
      { reason: ZIP_REJECT_REASONS.VIEW_MISMATCH, entry: SHEET_PART },
    );
  });
});

describe('patchUpload: crafted archives through the pipeline', () => {
  const patches: readonly CellPatch[] = [num(2, 1, '5')];

  it('refuses the hidden entry', () => {
    expectReason(
      () => patchFixture(hiddenEntryArchive().file, patches),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.LAYOUT,
    );
  });

  // 'same-sheet' is the case that matters (Review Focus 2): without the signature rule
  // the call would succeed and hand back a file whose local-header view still holds
  // the old sheet.
  it.each(TILE_KINDS)('refuses the hidden tile: %s', (kind) => {
    expectFileError(() => patchFixture(hiddenTileArchive(kind).file, patches), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.LAYOUT,
      entry: APP_PROPERTIES_PART,
    });
  });

  it('refuses the bomb tile without inflating it', () => {
    const { file } = hiddenTileArchive('bomb');
    const started = performance.now();
    const error = fileErrorOf(() => patchFixture(file, patches));
    expectWithinBudget(performance.now() - started, BOUNDED_INFLATE_BUDGET_MS);
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: APP_PROPERTIES_PART });
  });

  it.each(ZIP64_SKIP_COPIES)('refuses the zip64 local skip: %s', (copy) => {
    expectFileError(() => patchFixture(zip64SkipArchive(copy).file, patches), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.ZIP64,
      entry: APP_PROPERTIES_PART,
    });
  });

  it('refuses an entry with a 12-byte unsigned data descriptor in the gate', () => {
    // The stream ends this entry (the last one before the directory) 16 bytes before
    // the directory record signature, so the gate cannot inflate it and refuses the
    // file before the layout check runs; raw-zip.test.ts pins the layout's own refusal.
    const { file } = unsignedDescriptorArchive(UNSIGNED_DESCRIPTOR_32_LENGTH);
    const error = fileErrorOf(() => patchFixture(file, patches));
    const gateError = fileErrorOf(() => openUpload(file, GUARD_OPTS));
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.message).toBe(gateError.message);
    expect(error.meta).toEqual(gateError.meta);
  });

  it('refuses an entry with a 20-byte unsigned data descriptor in the layout check', () => {
    const { file } = unsignedDescriptorArchive(UNSIGNED_DESCRIPTOR_64_LENGTH);
    expectFileError(() => patchFixture(file, patches), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.LAYOUT,
      entry: SHEET_PART,
    });
  });

  // Both pass today's gate. Without the directory rule the call succeeded and handed back
  // an archive the gate refuses: here the formula overwrite drops the calcChain record
  // and the header in it that hid a second worksheet entry from the stream...
  it('refuses a fake entry hidden behind an incomplete header in the calcChain record', () => {
    expectFileError(
      () => patchFixture(swallowedEntryArchive().file, [num(2, 1, '9')]),
      'CORRUPT_FILE',
      { reason: ZIP_REJECT_REASONS.LAYOUT },
    );
  });

  // ...and here the new cell grows the worksheet past 64 KiB, which completes the bare
  // signature in front of its record.
  it('refuses a bare signature in a record comment that a size change completes', () => {
    expectFileError(() => patchFixture(sizeFlipArchive().file, [num(2, 2, '9')]), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.LAYOUT,
    });
  });
});

describe('patchUpload: a request that did not come through resolvePatchRequest', () => {
  /** Built by hand, so none of resolvePatchRequest's checks ran on it. */
  function handBuilt(patch: CellPatch): ResolvedPatchRequest {
    return { read: DEFAULT_READ, anchors: [], outputs: [[patch]], overwriteFormulaColumns: [] };
  }

  it.each<[string, CellPatch]>([
    ['a row past rowCap + 1', num(DEFAULT_READ.rowCap + 2, 0, '1')],
    ['a column at colCap', num(1, DEFAULT_READ.colCap, '1')],
  ])('refuses %s before any other check', (_, patch) => {
    expect(() => patchUpload(book(ONE_CELL), handBuilt(patch))).toThrow('Invalid patch request');
    // Before the gate too: bytes that are no workbook at all get the same error.
    expect(() => patchUpload(Buffer.from('nope'), handBuilt(patch))).toThrow(
      'Invalid patch request',
    );
  });
});

describe('assertSameViews on a hidden tile behind the layout check', () => {
  it('other-sheet: refuses the tile', () => {
    const { file, layout } = hiddenTileArchive('other-sheet');
    const parts = openUpload(file, GUARD_OPTS);
    expectFileError(() => assertSameViews(file, layout, parts), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
      entry: SHEET_PART,
    });
  });

  it('bomb: refuses the tile within the bounded-inflate budget', () => {
    const { file, layout } = hiddenTileArchive('bomb');
    const parts = openUpload(file, GUARD_OPTS);
    const started = performance.now();
    const error = fileErrorOf(() => assertSameViews(file, layout, parts));
    // The workbook is two rows; an unbounded inflate of the tile takes more than a second.
    expectWithinBudget(performance.now() - started, BOUNDED_INFLATE_BUDGET_MS);
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH });
  });

  it('same-sheet: the views compare equal', () => {
    // The tile holds the real sheet, so every content comparison passes: the layout
    // rule carries the guarantee, and this check does not.
    const { file, layout } = hiddenTileArchive('same-sheet');
    const parts = openUpload(file, GUARD_OPTS);
    expect(() => assertSameViews(file, layout, parts)).not.toThrow();
  });
});

describe('patchUpload: anchors', () => {
  const pin = pinOf(DISCOUNT_FIXTURE);
  const file = readFixture(DISCOUNT_FIXTURE);

  function request(expected: string): ResolvedPatchRequest {
    return resolvePatchRequest({
      sheetName: pin.sheetName,
      anchors: [{ excelRow: 2, col: 4, expected }],
      outputs: [[text(2, 8, 'x')]],
    });
  }

  it('patches when the shared-string anchor reads as expected', () => {
    const [output] = patchUpload(file, request(pin.firstBarcode));
    expect(output).toBeInstanceOf(Uint8Array);
  });

  it('refuses an anchor that reads otherwise', () => {
    expectFileError(() => patchUpload(file, request('OTHER')), 'ROW_ANCHOR_MISMATCH', {
      count: 1,
      rows: [2],
    });
  });
});

describe('patchUpload: sheet selection', () => {
  const file = buildXlsxFixture([
    { name: 'Help', xml: worksheetXml([['help']]) },
    { name: 'Data', xml: worksheetXml([['a'], ['b']]) },
  ]);
  const patches: readonly CellPatch[] = [num(1, 0, '5')];

  it('patches the sheet a strict selector names', () => {
    const out = patchFixture(file, patches, { sheet: { by: 'name', name: 'Data' } });
    expect(sameSegment(out, file, SHEET_PART)).toBe(true);
    expect(sameSegment(out, file, SECOND_SHEET_PART)).toBe(false);
    expect(readBack(out, { sheet: { by: 'name', name: 'Data' } })).toEqual([[5], ['b']]);
  });

  it('patches the first sheet when a legacy name matches none', () => {
    const out = patchFixture(file, patches, { sheetName: 'Nope' });
    expect(sameSegment(out, file, SECOND_SHEET_PART)).toBe(true);
    expect(readBack(out, { sheet: { by: 'name', name: 'Help' } })).toEqual([[5]]);
  });

  it('refuses a strict selector that matches no sheet', () => {
    expectFileError(
      () => patchFixture(file, patches, { sheet: { by: 'name', name: 'Nope' } }),
      'SHEET_NOT_FOUND',
      { by: 'name' },
    );
  });
});

describe('patchUpload: order of errors', () => {
  it('runs the gate first', () => {
    expectFileError(() => patchFixture(Buffer.from('nope'), [num(1, 0, '1')]), 'NOT_XLSX', {});
  });

  it('checks the layout before the reader', () => {
    const file = Buffer.concat([book(ONE_CELL), Buffer.alloc(1)]);
    expectFileError(
      () => patchFixture(file, [num(1, 0, '1')], { sheet: { by: 'name', name: 'Nope' } }),
      'CORRUPT_FILE',
      { reason: ZIP_REJECT_REASONS.LAYOUT },
    );
  });

  it('refuses a patch on a row the sheet does not have', () => {
    expectFileError(() => patchFixture(book(TWO_ROWS), [num(9, 0, '1')]), 'ROW_NOT_FOUND', {
      count: 1,
      rows: [9],
    });
  });

  it('refuses a worksheet part that is also the shared strings part', () => {
    const file = bookOf(worksheet(TWO_ROWS), {
      [RELS_PART]: relsOf(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'sharedStrings', 'worksheets/sheet1.xml'),
      ),
    });
    expectFileError(() => patchFixture(file, [num(1, 0, '1')]), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.TARGET_PART,
    });
  });

  it('refuses a worksheet part that is also the content types part', () => {
    // The content types part is no book part, so only its name refuses it: the calcChain
    // cut may rewrite that part.
    const types = contentTypesOf([`<sheetData xmlns="${MAIN_NAMESPACE}">${ONE_CELL}</sheetData>`]);
    const file = buildXlsxFixture(
      [{ name: 'Sheet1', xml: worksheet(ONE_CELL), relTarget: `/${CONTENT_TYPES_PART}` }],
      { [CONTENT_TYPES_PART]: types },
    );
    const reading = readSheet(openUpload(file, GUARD_OPTS), {
      caps: { rowCap: DEFAULT_READ.rowCap, colCap: DEFAULT_READ.colCap },
    });
    expect(reading.grid).toEqual([[7]]);
    expect(reading.partPath).toBe(CONTENT_TYPES_PART);
    expect(reading.partIsBookPart).toBe(false);
    expectFileError(() => patchFixture(file, [num(1, 0, '1')]), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.TARGET_PART,
    });
  });
});

describe('patchUpload: merged cells', () => {
  const rows = [1, 2, 3]
    .map(
      (row) =>
        `<row r="${row}">${['A', 'B', 'C'].map((column) => `<c r="${column}${row}"><v>${row}</v></c>`).join('')}</row>`,
    )
    .join('');
  const merged = '<mergeCell ref="B2:C3"/>';

  it('refuses a target inside a merged range', () => {
    const file = bookOf(worksheet(rows, `<mergeCells count="1">${merged}</mergeCells>`));
    expectFileError(() => patchFixture(file, [num(2, 2, '5')]), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.MERGED_TARGET,
      count: 1,
      rows: [2],
    });
  });

  it("patches the range's top-left corner", () => {
    const file = bookOf(worksheet(rows, `<mergeCells count="1">${merged}</mergeCells>`));
    expect(readBack(patchFixture(file, [num(2, 1, '5')]))).toEqual([
      [1, 1, 1],
      [2, 5, 2],
      [3, 3, 3],
    ]);
  });

  it('sees the range behind a decoy block', () => {
    const decoy = '<d:mergeCells xmlns:d="urn:decoy"><d:mergeCell ref="Z99"/></d:mergeCells>';
    const file = bookOf(worksheet(rows, `${decoy}<mergeCells>${merged}</mergeCells>`));
    expectFileError(() => patchFixture(file, [num(3, 2, '5')]), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.MERGED_TARGET,
      count: 1,
      rows: [3],
    });
  });
});

describe('patchUpload: array formula ranges', () => {
  // E2 holds the array formula of E2:E4; E3 and E4 hold only their cached values, no f.
  const arrayFormulaRows =
    '<row r="2"><c r="D2"><v>1</v></c><c r="E2"><f t="array" ref="E2:E4">D2:D4*2</f><v>2</v></c></row>' +
    '<row r="3"><c r="D3"><v>2</v></c><c r="E3"><v>4</v></c></row>' +
    '<row r="4"><c r="D4"><v>3</v></c><c r="E4"><v>6</v></c></row>';
  const COL_D = 3;
  const COL_E = 4;

  it('refuses a target inside the range on a cell that holds no formula', () => {
    expectFileError(
      () => patchFixture(book(arrayFormulaRows), [num(3, COL_E, '5')]),
      'MALFORMED_SHEET',
      {
        reason: MALFORMED_SHEET_REASONS.SHARED_FORMULA,
        count: 1,
        rows: [3],
      },
    );
  });

  it('refuses every cell of the range, the top-left one included', () => {
    const patches = [num(2, COL_E, '5'), num(3, COL_E, '5'), num(4, COL_E, '5')];
    expectFileError(() => patchFixture(book(arrayFormulaRows), patches), 'MALFORMED_SHEET', {
      reason: MALFORMED_SHEET_REASONS.SHARED_FORMULA,
      count: 3,
      rows: [2, 3, 4],
    });
  });

  it('patches a cell outside the range', () => {
    expect(readBack(patchFixture(book(arrayFormulaRows), [num(3, COL_D, '9')]))).toEqual([
      [null, null, null, null, null],
      [null, null, null, 1, 2],
      [null, null, null, 9, 4],
      [null, null, null, 3, 6],
    ]);
  });
});

describe('patchUpload: calcChain', () => {
  const formulaSheet = worksheet(
    '<row r="1"><c r="A1"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><f>1+1</f><v>2</v></c></row>',
  );
  const calcChain = `${XML_DECLARATION}<calcChain xmlns="${MAIN_NAMESPACE}"><c r="B2" i="1"/></calcChain>`;
  const workbookOverride =
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  const worksheetOverride =
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  const calcChainOverride = `<Override PartName="/xl/calcChain.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`;

  /** The formula workbook with a calcChain relationship to `target` and the given Overrides. */
  function calcChainBook(target: string, overrides: readonly string[]): Buffer {
    return bookOf(formulaSheet, {
      [RELS_PART]: relsOf(
        relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        relationship('rId2', 'calcChain', target),
      ),
      [CONTENT_TYPES_PART]: contentTypesOf(overrides),
      [CALC_CHAIN_PART]: calcChain,
    });
  }

  const file = calcChainBook('calcChain.xml', [
    workbookOverride,
    worksheetOverride,
    calcChainOverride,
  ]);
  const flaggedB: PatchFixtureOptions = { overwriteFormulaColumns: [1] };

  it('drops the chain when a formula is overwritten', () => {
    const out = patchFixture(file, [num(2, 1, '5')], flaggedB);
    expect(unzipSync(out)[CALC_CHAIN_PART]).toBeUndefined();
    expect(entryText(out, RELS_PART)).not.toContain('calcChain');
    expect(entryText(out, CONTENT_TYPES_PART)).not.toContain('calcChain');
    expect(readBack(out)).toEqual([
      [1, null],
      [3, 5],
    ]);
    expect(() => readZipLayout(out)).not.toThrow();
  });

  it('keeps the chain when no formula is overwritten', () => {
    const out = patchFixture(file, [num(2, 0, '4')], flaggedB);
    for (const name of [CALC_CHAIN_PART, RELS_PART, CONTENT_TYPES_PART]) {
      expect(sameSegment(out, file, name)).toBe(true);
    }
  });

  // No Override names these parts, so calc-chain.ts's own Override rule cannot refuse
  // the content types first: the refusal comes from the pipeline's check of the paths.
  it.each<[string, string]>([
    ['worksheets/sheet1.xml', SHEET_PART],
    ['workbook.xml', 'xl/workbook.xml'],
    ['_rels/workbook.xml.rels', RELS_PART],
    ['/[Content_Types].xml', CONTENT_TYPES_PART],
    ['/_rels/.rels', '_rels/.rels'],
  ])('refuses a calcChain Target that names a needed part: %s', (target, entry) => {
    expectFileError(
      () => patchFixture(calcChainBook(target, []), [num(2, 1, '5')], flaggedB),
      'CORRUPT_FILE',
      { reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry },
    );
  });

  it('compares the paths folding ASCII case', () => {
    // The worksheet has no Override (a Default covers it), so nothing but the folded
    // comparison sees that this Target names the patched part.
    const crafted = calcChainBook('Worksheets/Sheet1.xml', [workbookOverride]);
    expectFileError(() => patchFixture(crafted, [num(2, 1, '5')], flaggedB), 'CORRUPT_FILE', {
      reason: ZIP_REJECT_REASONS.PACKAGE_PART,
      entry: 'xl/Worksheets/Sheet1.xml',
    });
  });

  // A Target is free text and may name a part other relationships use, typed by a
  // Default only. With no Override of the calcChain content type, nothing confirms it
  // is a calcChain: its relationship is cut (no opener loads it as one) and its entry
  // stays.
  it.each<[target: string, extension: string, contentType: string, relationshipType: string]>([
    ['media/image1.png', 'png', PNG_CONTENT_TYPE, 'image'],
    ['drawings/vmlDrawing1.vml', 'vml', VML_CONTENT_TYPE, 'vmlDrawing'],
  ])(
    'keeps a part a calcChain Target names without a calcChain Override: %s',
    (target, extension, contentType, relationshipType) => {
      const part = `xl/${target}`;
      const sheetTarget = `../${target}`;
      const file = bookOf(formulaSheet, {
        [RELS_PART]: relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'calcChain', target),
        ),
        [CONTENT_TYPES_PART]: contentTypesOf(
          [workbookOverride, worksheetOverride],
          [`<Default Extension="${extension}" ContentType="${contentType}"/>`],
        ),
        [SHEET_RELS_PART]: relsOf(relationship('rId1', relationshipType, sheetTarget)),
        [part]: SHARED_PART_BYTES,
      });

      const out = patchFixture(file, [num(2, 1, '5')], flaggedB);

      expect(entryText(out, RELS_PART)).not.toContain('calcChain');
      expect(sameSegment(out, file, part)).toBe(true);
      // The sheet relationship still resolves: it is unchanged, and its Target's entry is there.
      expect(sameSegment(out, file, SHEET_RELS_PART)).toBe(true);
      expect(entryText(out, SHEET_RELS_PART)).toContain(`Target="${sheetTarget}"`);
      expect(readZipLayout(out).entries.map((entry) => entry.name)).toContain(part);
      expect(readBack(out)).toEqual([
        [1, null],
        [3, 5],
      ]);
    },
  );

  it('drops the entry of a calcChain Override that matches the Target in another ASCII case', () => {
    // The Target names 'xl/CalcChain.xml'; the Override and the entry spell it
    // 'xl/calcChain.xml'. OPC compares part names folding ASCII case, so the cut
    // Override confirms the entry, which goes with it.
    const crafted = calcChainBook('CalcChain.xml', [
      workbookOverride,
      worksheetOverride,
      calcChainOverride,
    ]);
    const out = patchFixture(crafted, [num(2, 1, '5')], flaggedB);
    expect(unzipSync(out)[CALC_CHAIN_PART]).toBeUndefined();
    expect(entryText(out, RELS_PART)).not.toContain('calcChain');
    expect(entryText(out, CONTENT_TYPES_PART)).not.toContain('calcChain');
  });
});

describe('patchUpload: unchanged outputs', () => {
  const file = book(ONE_CELL);

  it('answers null for an output that changes nothing', () => {
    const outputs = patchUpload(
      file,
      resolvePatchRequest({ outputs: [[clear(1, 1)], [num(1, 0, '9')]] }),
    );
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toBeNull();
    expect(outputs[1]).toBeInstanceOf(Uint8Array);
  });

  it('patchFixture returns the source itself', () => {
    expect(patchFixture(file, [clear(1, 1)])).toBe(file);
  });
});

describe('patchFixture: defaults', () => {
  const file = book('<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>');

  it('overwrites a formula in any column when no column is flagged', () => {
    expect(readBack(patchFixture(file, [num(1, 0, '9')]))).toEqual([[9]]);
  });

  it('keeps the formula policy when the columns are given', () => {
    expectReason(
      () => patchFixture(file, [num(1, 0, '9')], { overwriteFormulaColumns: [] }),
      'MALFORMED_SHEET',
      MALFORMED_SHEET_REASONS.FORMULA_TARGET,
    );
  });
});

describe('patchUpload: caps', () => {
  const file = book(ONE_CELL);
  const longText = 'x'.repeat(MAX_PATCH_TEXT_LENGTH);

  it('refuses a patched part beyond its growth cap', () => {
    expectReason(
      () => patchFixture(file, [text(1, 0, longText), text(1, 1, longText), text(1, 2, longText)]),
      'PAYLOAD_TOO_LARGE',
      PATCH_LIMIT_REASONS.GROWTH,
    );
  });

  it('writes one value of the longest length', () => {
    expect(readBack(patchFixture(file, [text(1, 0, longText)]))).toEqual([[longText]]);
  });

  it('bounds the bytes of all outputs together', () => {
    expect(() => assertOutputBudget(MAX_PATCH_OUTPUT_TOTAL_BYTES)).not.toThrow();
    expectFileError(
      () => assertOutputBudget(MAX_PATCH_OUTPUT_TOTAL_BYTES + 1),
      'PAYLOAD_TOO_LARGE',
      {
        reason: PATCH_LIMIT_REASONS.OUTPUT,
        cap: MAX_PATCH_OUTPUT_TOTAL_BYTES,
      },
    );
  });

  it('writes an output longer than the read byte cap, which the import gate then refuses', () => {
    // Export outputs are bounded by the patch growth cap and the total output budget,
    // not by the import caps: an output goes to the marketplace, not back through our
    // import gate. Re-importing such an output is refused at upload time instead.
    // The upload sits READ_CAP_MARGIN bytes under the cap; a text deflate cannot shrink
    // much makes the output longer than the cap.
    const length = DEFAULT_READ.maxBytes - READ_CAP_MARGIN;
    const nearCap = withStoredBlob(book(ONE_CELL), length);
    expect(nearCap.length).toBe(length);

    const out = patchFixture(nearCap, [text(1, 0, hexText(MAX_PATCH_TEXT_LENGTH))]);

    expect(out.length).toBeGreaterThan(DEFAULT_READ.maxBytes);
    expectFileError(() => readBack(out), 'PAYLOAD_TOO_LARGE', {
      maxBytes: DEFAULT_READ.maxBytes,
      received: out.length,
    });
  });
});

// Builds outputs of about 16.5 MiB each, 132 MiB at once.
describe.runIf(process.env.CI === 'true')('patchUpload: the bytes of all outputs together', () => {
  let large: Buffer | undefined;

  // Built on first use: a skipped suite still runs this callback to collect its tests.
  function largeUpload(): Buffer {
    large ??= withStoredBlob(book(ONE_CELL), LARGE_UPLOAD_BYTES);
    return large;
  }

  /** `count` outputs, each with one changed cell. */
  function request(count: number): ResolvedPatchRequest {
    return resolvePatchRequest({
      maxBytes: LARGE_READ_MAX_BYTES,
      outputs: Array.from({ length: count }, () => [num(1, 0, '9')]),
    });
  }

  it('raises the read cap within its ceiling', () => {
    expect(LARGE_READ_MAX_BYTES).toBeLessThanOrEqual(ABSOLUTE_MAX_BYTES);
    expect(request(1).read.maxBytes).toBe(LARGE_READ_MAX_BYTES);
  });

  it('refuses eight outputs beyond the total', () => {
    expectFileError(
      () => patchUpload(largeUpload(), request(MAX_PATCH_OUTPUTS)),
      'PAYLOAD_TOO_LARGE',
      { reason: PATCH_LIMIT_REASONS.OUTPUT, cap: MAX_PATCH_OUTPUT_TOTAL_BYTES },
    );
  });

  it('writes seven outputs within the total', () => {
    const outputs = patchUpload(largeUpload(), request(MAX_PATCH_OUTPUTS - 1));
    expect(outputs).toHaveLength(MAX_PATCH_OUTPUTS - 1);
    for (const output of outputs) expect(output).toBeInstanceOf(Uint8Array);
  });
});

describe('patchUpload: written values', () => {
  it('writes formula-like text as inert text', () => {
    const out = patchFixture(book(ONE_CELL), [text(1, 0, INERT_FORMULA_TEXT)]);
    expect(readBack(out)).toEqual([[INERT_FORMULA_TEXT]]);
  });

  it('keeps a date style, so a number reads back as a Date', () => {
    // The engine keeps `s` as it is; whether a format may write a number into a
    // date-styled cell is PR 3's rule.
    const styles =
      `${XML_DECLARATION}<styleSheet xmlns="${MAIN_NAMESPACE}"><cellXfs count="2">` +
      '<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>';
    const file = bookOf(
      worksheet('<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2" s="1"/></row>'),
      {
        [RELS_PART]: relsOf(
          relationship('rId1', 'worksheet', 'worksheets/sheet1.xml'),
          relationship('rId2', 'styles', 'styles.xml'),
        ),
        [STYLES_PART]: styles,
      },
    );

    const out = patchFixture(file, [num(2, 0, DATE_SERIAL)]);

    expect(entryText(out, SHEET_PART)).toContain(`<c r="A2" s="1"><v>${DATE_SERIAL}</v></c>`);
    expect(readBack(out)[1]?.[0]).toBeInstanceOf(Date);
  });
});
