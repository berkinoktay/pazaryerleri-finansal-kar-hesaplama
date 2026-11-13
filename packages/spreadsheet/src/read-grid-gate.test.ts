import { strToU8, unzipSync, type Unzipped } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_FORMAT_CODE_LENGTH, MAX_WORKBOOK_RELS_BYTES } from './constants';
import { SpreadsheetFileError, type SpreadsheetFileErrorCode } from './errors';
import type { SheetData } from './grid-types';
import { openUpload } from './guards';
import { readWorkbookGrid } from './parse';
import { checkUploadParts, readUploadGrid } from './read-grid';
import { resolveReadOptions, type ReadGridOptions } from './read-options';
import { resolveWorksheetPartPaths } from './index';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import { localName } from './xml-dom';
import { ZIP_REJECT_REASONS } from './patch/reasons';
import { fileErrorOf } from '../tests/helpers/errors';
import { expectWithinBudget, LINEAR_BUDGET_MS } from '../tests/helpers/timing';

// The gate must see what the reader sees. Each case below is a way of writing a
// worksheet so that a text (regex) scan and the reader's DOM disagree: the DOM still
// holds the forged <dimension> or the far-away cell, the regex did not. Every case
// goes through the real read path and must end in a
// SpreadsheetFileError or a tiny grid, quickly. The forged refs are full size
// (A1:ZZ300000 is a 300 000 x 702 grid); a gate that misses one would crash the
// test run, so the dimension cases are only meaningful against the DOM gate.

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const FORGED_REF = 'A1:ZZ300000';
const FAR_CELL = 'A200000';
const GUARD_OPTS = { rowCap: 5_000, colCap: 64, maxBytes: 10 * 1024 * 1024 } as const;
const GATE_CAPS = { rowCap: GUARD_OPTS.rowCap, colCap: GUARD_OPTS.colCap } as const;
// Timing budgets (enforced in CI only, see tests/helpers/timing.ts) are loose on purpose:
// CI runs many suites in parallel. The regressions these tests guard against are
// quadratic or allocation blow-ups that take minutes or crash, so a bound in the tens of
// seconds still separates the two. They time the in-process read path: through the
// worker, its 30 s time limit would cap the elapsed time and hide a quadratic regression
// as a timeout. The test timeout stops a pass that never ends, locally too.
const READ_BUDGET_MS = 15_000;
const TIMING_TEST_TIMEOUT_MS = 120_000;
const MALFORMED_COUNT = 200_000;
const LONG_NAME_LENGTH = 40_000;
const LONG_NAME_BUDGET_MS = 15_000;
const REPEATED_CHILDREN = 20_000;
const RELS_SHEET_PART = 'xl/worksheets/s.xml.rels';
const RELS_SHEET_TARGET = 'worksheets/s.xml.rels';
const STYLES_PART = 'xl/styles.xml';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_RELATIONSHIP = `<Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/>`;
const SHARED_STRINGS_RELATIONSHIP = `<Relationship Id="rId2" Type="${OFFICE_REL}/sharedStrings" Target="sharedStrings.xml"/>`;
// Excel serial date 45000 (2023-03-15); any custom date format makes it a Date.
const SERIAL_DATE = 45_000;
const SERIAL_DATE_AS_DATE = new Date('2023-03-15T00:00:00.000Z');

const TWO_ROW_GRID: SheetData = [['Barkod'], ['X1']];

type Outcome =
  | { readonly kind: 'grid'; readonly grid: SheetData }
  | { readonly kind: 'error'; readonly code: SpreadsheetFileErrorCode };

interface ReadCase {
  readonly name: string;
  readonly xml: string;
  readonly options?: ReadGridOptions;
  readonly expected: Outcome;
}

function grid(value: SheetData): Outcome {
  return { kind: 'grid', grid: value };
}

function rejected(code: SpreadsheetFileErrorCode): Outcome {
  return { kind: 'error', code };
}

function inlineCell(ref: string, text: string, p = ''): string {
  return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${text}</${p}t></${p}is></${p}c>`;
}

const TWO_ROWS =
  `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}</row>` +
  `<row r="2">${inlineCell('A2', 'X1')}</row></sheetData>`;

function sheet(
  inner: string,
  opts: { readonly root?: string; readonly extraNs?: string } = {},
): string {
  const root = opts.root ?? 'worksheet';
  return `${XML_DECLARATION}<${root} xmlns="${SPREADSHEET_NS}"${opts.extraNs ?? ''}>${inner}</${root}>`;
}

/** Header cell in row 1, `cellXml` alone in row 2. */
function sheetWithCell(cellXml: string, extraNs = ''): string {
  return sheet(
    `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}</row><row r="2">${cellXml}</row></sheetData>`,
    { extraNs },
  );
}

const U_PREFIX_NS = ` xmlns:ü="${SPREADSHEET_NS}"`;
const X_PREFIX_NS = ` xmlns:x="${SPREADSHEET_NS}"`;

async function readOutcome(file: Buffer, options: ReadGridOptions = {}): Promise<Outcome> {
  try {
    return grid(await readWorkbookGrid(file, options));
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return rejected(e.code);
    throw e;
  }
}

/** The in-process read path (gate, then reader) with the default limits. */
function uploadOutcome(file: Buffer, options: ReadGridOptions = {}): Outcome {
  try {
    return grid(readUploadGrid(file, resolveReadOptions(options)));
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return rejected(e.code);
    throw e;
  }
}

/** The gate alone: every reader part parsed strictly and checked, no grid built. */
function gateOutcome(file: Buffer): SpreadsheetFileErrorCode | null {
  try {
    checkUploadParts(openUpload(file, GUARD_OPTS), GATE_CAPS);
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e.code;
    throw e;
  }
}

/** Names of the reader parts the gate returns for `file`. */
function readerPartNames(file: Buffer): string[] {
  return Object.keys(openUpload(file, GUARD_OPTS));
}

async function timedOutcome(
  xml: string,
  options: ReadGridOptions = {},
): Promise<{ readonly outcome: Outcome; readonly elapsedMs: number }> {
  const file = buildXlsxFixture([{ name: 'Sheet1', xml }]);
  const started = performance.now();
  const outcome = uploadOutcome(file, options);
  return { outcome, elapsedMs: performance.now() - started };
}

/** A workbook rels part holding the given Relationship elements. */
function relsOf(...relationships: readonly string[]): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${relationships.join('')}</Relationships>`;
}

/** Workbook rels naming sheet1 and the shared strings part. */
const SHARED_STRINGS_RELS = relsOf(SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP);

const DIMENSION_CASES: readonly ReadCase[] = [
  {
    name: 'a ">" inside an earlier attribute value',
    xml: sheet(`<dimension x=">" ref="${FORGED_REF}"/>${TWO_ROWS}`),
    expected: grid(TWO_ROW_GRID),
  },
  {
    name: 'a comment child',
    xml: sheet(`<dimension ref="${FORGED_REF}"><!--c--></dimension>${TWO_ROWS}`),
    expected: grid(TWO_ROW_GRID),
  },
  {
    name: 'a single-quoted ref with an empty comment child',
    xml: sheet(`<dimension ref='${FORGED_REF}'><!----></dimension>${TWO_ROWS}`),
    expected: grid(TWO_ROW_GRID),
  },
  {
    name: 'a non-ASCII namespace prefix',
    xml: sheet(`<ü:dimension ref="${FORGED_REF}"/>${TWO_ROWS}`, { extraNs: U_PREFIX_NS }),
    expected: grid(TWO_ROW_GRID),
  },
  {
    name: 'an x: namespace prefix',
    xml: sheet(`<x:dimension ref="${FORGED_REF}"/>${TWO_ROWS}`, { extraNs: X_PREFIX_NS }),
    expected: grid(TWO_ROW_GRID),
  },
  {
    name: 'a root element not named worksheet',
    xml: sheet(`<dimension ref="${FORGED_REF}"/>${TWO_ROWS}`, { root: 'ws' }),
    expected: grid(TWO_ROW_GRID),
  },
  {
    // Real files carry at most one; more than one is corrupt (and removing
    // thousands one by one was quadratic).
    name: 'two dimension elements',
    xml: sheet(`<dimension ref="A1"/><dimension ref="${FORGED_REF}"/>${TWO_ROWS}`),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a dimension assembled around a nested one',
    xml: sheet(`<dimen<dimension/>sion ref="${FORGED_REF}"/>${TWO_ROWS}`),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    // The original evidence file: a ~1.5 KB upload that crashed the API.
    name: 'the dimension OOM evidence file',
    xml: worksheetXml([['Barkod'], ['X1']], { dimension: FORGED_REF }),
    expected: grid(TWO_ROW_GRID),
  },
  {
    // Trendyol writes a bogus single-cell ref on full sheets; honouring it made
    // the reader drop every data row.
    name: 'a bogus single-cell dimension on a full sheet',
    xml: sheet(`<dimension ref="A1"/>${TWO_ROWS}`),
    expected: grid(TWO_ROW_GRID),
  },
];

const CELL_REFERENCE_CASES: readonly ReadCase[] = [
  {
    name: 'a four-letter column (r="AAAA1")',
    xml: sheetWithCell(inlineCell('AAAA1', 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a three-letter column beyond the cap (r="AAA2")',
    xml: sheetWithCell(inlineCell('AAA2', 'x')),
    expected: rejected('COL_CAP_EXCEEDED'),
  },
  {
    name: 'r after another attribute (s="1" r="BZ2")',
    xml: sheetWithCell('<c s="1" r="BZ2"><v>1</v></c>'),
    expected: rejected('COL_CAP_EXCEEDED'),
  },
  {
    name: "a single-quoted r (r='A200000')",
    xml: sheetWithCell(`<c r='${FAR_CELL}' t="inlineStr"><is><t>x</t></is></c>`),
    expected: rejected('ROW_CAP_EXCEEDED'),
  },
  {
    name: 'spaces around = (r = "A200000")',
    xml: sheetWithCell(`<c r = "${FAR_CELL}" t="inlineStr"><is><t>x</t></is></c>`),
    expected: rejected('ROW_CAP_EXCEEDED'),
  },
  {
    name: 'a leading space (r=" A200000")',
    xml: sheetWithCell(inlineCell(` ${FAR_CELL}`, 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a character reference (r="&#65;200000")',
    xml: sheetWithCell(inlineCell('&#65;200000', 'x')),
    expected: rejected('ROW_CAP_EXCEEDED'),
  },
  {
    name: 'a ">" in an earlier attribute (s=">")',
    xml: sheetWithCell(`<c s=">" r="${FAR_CELL}" t="inlineStr"><is><t>x</t></is></c>`),
    expected: rejected('ROW_CAP_EXCEEDED'),
  },
  {
    name: 'a non-ASCII namespace prefix on the cell',
    xml: sheetWithCell(inlineCell(FAR_CELL, 'x', 'ü:'), U_PREFIX_NS),
    expected: rejected('ROW_CAP_EXCEEDED'),
  },
  {
    name: 'a reference assembled around a nested element',
    xml: sheetWithCell(inlineCell('A2<dimension/>00000', 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a lowercase column (r="a1")',
    xml: sheetWithCell(inlineCell('a1', 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'row zero (r="A0")',
    xml: sheetWithCell(inlineCell('A0', 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a row number with a leading zero (r="A02")',
    xml: sheetWithCell(inlineCell('A02', 'x')),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'no r attribute',
    xml: sheetWithCell('<c t="inlineStr"><is><t>x</t></is></c>'),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a column that goes back within a row',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('B1', 'Barkod')}${inlineCell('A1', 'x')}</row></sheetData>`,
    ),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'the same column twice in a row',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}${inlineCell('A1', 'x')}</row></sheetData>`,
    ),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'cells of two different rows inside one row',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}${inlineCell('B2', 'x')}</row></sheetData>`,
    ),
    expected: rejected('CORRUPT_FILE'),
  },
  {
    // colCap 2: a row may hold 4 x 2 + 16 = 24 child nodes, text and comments included.
    name: 'a row with more child nodes than the cap allows',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}${'<!---->'.repeat(24)}</row></sheetData>`,
    ),
    options: { colCap: 2 },
    expected: rejected('CORRUPT_FILE'),
  },
  {
    name: 'a row with exactly as many child nodes as the cap allows',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}${'<!---->'.repeat(23)}</row></sheetData>`,
    ),
    options: { colCap: 2 },
    expected: grid([['Barkod']]),
  },
  {
    name: 'rows x cols beyond the total-cell cap at the absolute row and col caps',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}${inlineCell('IV1', 'x')}</row>` +
        `<row r="20001">${inlineCell('A20001', 'y')}</row></sheetData>`,
    ),
    options: { rowCap: 20_000, colCap: 256 },
    expected: rejected('PAYLOAD_TOO_LARGE'),
  },
];

const FORMULA_CASES: readonly ReadCase[] = [
  {
    name: 'a cached formula whose value child has another prefix keeps its value',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}` +
        `<x:c r="B1"><x:f>1+1</x:f><v>2</v></x:c></row></sheetData>`,
      { extraNs: X_PREFIX_NS },
    ),
    expected: grid([['Barkod', 2]]),
  },
  {
    name: 'an unprefixed uncached formula cell is emptied',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}` +
        `<c r="B1" t="str"><f>IF(ISBLANK(A1),"","Hayir")</f></c>` +
        `${inlineCell('C1', 'keep')}</row></sheetData>`,
    ),
    expected: grid([['Barkod', null, 'keep']]),
  },
  {
    name: 'a prefixed uncached formula cell is emptied',
    xml: sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}` +
        `<x:c r="B1" t="str"><x:f>IF(ISBLANK(A1),"","Hayir")</x:f></x:c>` +
        `${inlineCell('C1', 'keep')}</row></sheetData>`,
      { extraNs: X_PREFIX_NS },
    ),
    expected: grid([['Barkod', null, 'keep']]),
  },
  {
    // Regression: the helper column (uncached formula) sits after two cached
    // formula cells on every row; a cross-cell scan once swallowed all three.
    name: 'cached formula cells before an uncached one keep their values',
    xml: sheet(
      '<sheetData><row r="1">' +
        '<c r="A1" t="n"><f>X2</f><v>0.0</v></c>' +
        '<c r="B1" t="n"><f>Y2</f><v>15.4</v></c>' +
        '<c r="C1" t="str"><f>IF(ISBLANK(Q2),"","Hayir")</f></c>' +
        `${inlineCell('D1', 'keep')}</row></sheetData>`,
    ),
    expected: grid([[0, 15.4, null, 'keep']]),
  },
  {
    name: 'a cached x:-prefixed formula cell keeps its value',
    xml:
      `${XML_DECLARATION}<x:worksheet${X_PREFIX_NS}><x:sheetData><x:row r="1">` +
      '<x:c r="A1" t="n"><x:f>1+1</x:f><x:v>2</x:v></x:c>' +
      '</x:row></x:sheetData></x:worksheet>',
    expected: grid([[2]]),
  },
];

describe('grid gate: forged <dimension>', () => {
  it.each(DIMENSION_CASES)('$name', async ({ xml, options, expected }) => {
    const { outcome, elapsedMs } = await timedOutcome(xml, options);
    expect(outcome).toEqual(expected);
    expectWithinBudget(elapsedMs, READ_BUDGET_MS);
  });
});

describe('grid gate: cell references', () => {
  it.each(CELL_REFERENCE_CASES)('$name', async ({ xml, options, expected }) => {
    const { outcome, elapsedMs } = await timedOutcome(xml, options);
    expect(outcome).toEqual(expected);
    expectWithinBudget(elapsedMs, READ_BUDGET_MS);
  });
});

describe('grid gate: formula cells', () => {
  it.each(FORMULA_CASES)('$name', async ({ xml, options, expected }) => {
    const { outcome } = await timedOutcome(xml, options);
    expect(outcome).toEqual(expected);
  });
});

describe('grid gate: a worksheet stored under a .xml.rels name', () => {
  // The reader opens every entry ending in .xml or .xml.rels and resolves a sheet
  // from the workbook rels Target. The gate walks every entry named .rels as a
  // relationships part, whose schema has no element below a Relationship, so a
  // worksheet with rows stored under such a name is refused before the reader opens
  // it: neither its forged dimension nor its far cells reach the grid.
  function relsSheet(xml: string): Buffer {
    return buildXlsxFixture([
      { name: 'Sheet1', xml, partPath: RELS_SHEET_PART, relTarget: RELS_SHEET_TARGET },
    ]);
  }

  async function expectRefusedAsPackagePart(file: Buffer): Promise<void> {
    const error = fileErrorOf(() => openUpload(file, GUARD_OPTS));
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({
      reason: ZIP_REJECT_REASONS.PACKAGE_PART,
      entry: RELS_SHEET_PART,
    });
    expect(await readOutcome(file)).toEqual(rejected('CORRUPT_FILE'));
  }

  it('refuses one with a forged dimension before the reader sizes its grid', async () => {
    const file = relsSheet(
      worksheetXml(
        [
          ['Barkod', 'B'],
          ['X1', 'Y'],
        ],
        { dimension: 'A1:A1' },
      ),
    );
    await expectRefusedAsPackagePart(file);
  });

  it('refuses one with cells beyond the caps before the reader reads them', async () => {
    const xml = sheet(
      `<sheetData><row r="1">${inlineCell('A1', 'Barkod')}</row>` +
        `<row r="9000">${inlineCell('CZ9000', 'far')}</row></sheetData>`,
    );
    await expectRefusedAsPackagePart(relsSheet(xml));
  });
});

describe('grid gate: smuggling', () => {
  it('rejects a DOCTYPE assembled around nested dimensions', async () => {
    const xml =
      `${XML_DECLARATION}<!DOC<dimension/>TYPE worksheet [<!ENT<dimension/>ITY a "XYZ">]>` +
      `<worksheet xmlns="${SPREADSHEET_NS}">${TWO_ROWS}</worksheet>`;
    const { outcome, elapsedMs } = await timedOutcome(xml);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(['UNSAFE_CONTENT', 'CORRUPT_FILE']).toContain(outcome.code);
    }
    expectWithinBudget(elapsedMs, READ_BUDGET_MS);
  });
});

// Malformed or deeply nested worksheets. The outcome does not matter (most are
// CORRUPT_FILE); what matters is that the gate stays linear in the input length.
const LINEAR_CASES: ReadonlyArray<{ readonly name: string; readonly xml: string }> = [
  {
    name: 'a run of "<c " openers',
    xml: `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${'<c '.repeat(MALFORMED_COUNT)}`,
  },
  {
    name: 'a run of "<row " openers',
    xml: `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${'<row '.repeat(MALFORMED_COUNT)}`,
  },
  {
    name: 'a run of unclosed cells',
    xml: sheet(`<sheetData><row r="1">${'<c r="A1">'.repeat(MALFORMED_COUNT)}</row></sheetData>`),
  },
  {
    name: 'a run of unclosed cells ended by one close tag',
    xml: sheet(
      `<sheetData><row r="1">${'<c r="A1">'.repeat(MALFORMED_COUNT)}<f>B1</f></c></row></sheetData>`,
    ),
  },
  {
    name: 'well-formed cells nested inside each other',
    xml: sheet(
      `<sheetData><row r="1">${'<c r="A1">'.repeat(MALFORMED_COUNT)}` +
        `${'</c>'.repeat(MALFORMED_COUNT)}</row></sheetData>`,
    ),
  },
];

describe('grid gate: linear time', { timeout: TIMING_TEST_TIMEOUT_MS }, () => {
  it.each(LINEAR_CASES)('$name', async ({ xml }) => {
    const { elapsedMs } = await timedOutcome(xml);
    expectWithinBudget(elapsedMs, LINEAR_BUDGET_MS);
  });

  it('rejects a root with 20 000 dimension children quickly', async () => {
    const { outcome, elapsedMs } = await timedOutcome(
      sheet(`${'<dimension/>'.repeat(REPEATED_CHILDREN)}${TWO_ROWS}`),
    );
    expect(outcome).toEqual(rejected('CORRUPT_FILE'));
    expectWithinBudget(elapsedMs, READ_BUDGET_MS);
  });

  it('handles an uncached formula cell with 20 000 formula children quickly', async () => {
    const { elapsedMs } = await timedOutcome(
      sheet(
        `<sheetData><row r="1"><c r="A1">${'<f/>'.repeat(REPEATED_CHILDREN)}</c></row></sheetData>`,
      ),
    );
    expectWithinBudget(elapsedMs, READ_BUDGET_MS);
  });

  // The old reader's tag-name regex was quadratic in the name length: this ~1.5 KB
  // upload kept it busy for about two seconds before the name cap.
  it('rejects a tiny upload with a very long element name before the reader sees it', async () => {
    const { outcome, elapsedMs } = await timedOutcome(
      sheet(`<${'a'.repeat(LONG_NAME_LENGTH)}/>${TWO_ROWS}`),
    );
    expect(outcome).toEqual(rejected('UNSAFE_CONTENT'));
    expectWithinBudget(elapsedMs, LONG_NAME_BUDGET_MS);
  });
});

describe('localName', () => {
  // Must match the old reader's getTagName, `tagName.replace(/.+:/, '')`.
  it.each(['c', 'x:c', 'ü:dimension', 'sheetData', 'a:b:c', ':c', 'x:'])('%s', (tagName) => {
    expect(localName(tagName)).toBe(tagName.replace(/.+:/, ''));
  });
});

// The worksheet parts the workbook rels name, resolved the way the reader does; the
// export patcher touches only these.
describe('resolveWorksheetPartPaths', () => {
  function entriesOf(
    relationships: string,
    extra: Readonly<Record<string, string>> = {},
  ): Unzipped {
    return unzipSync(
      new Uint8Array(
        buildXlsxFixture([{ name: 'Sheet1', xml: sheet(TWO_ROWS) }], {
          'xl/_rels/workbook.xml.rels': relsOf(relationships),
          ...extra,
        }),
      ),
    );
  }

  it('returns each worksheet Target once, relative and absolute alike', () => {
    const entries = entriesOf(
      SHEET_RELATIONSHIP +
        `<Relationship Id="rId3" Type="${OFFICE_REL}/worksheet" Target="/xl/worksheets/data.xml"/>` +
        `<Relationship Id="rId4" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/>`,
    );
    expect(resolveWorksheetPartPaths(entries)).toEqual([SHEET_PART, 'xl/worksheets/data.xml']);
  });

  it('leaves out the styles and shared strings Targets', () => {
    const entries = entriesOf(
      SHEET_RELATIONSHIP +
        SHARED_STRINGS_RELATIONSHIP +
        `<Relationship Id="rId3" Type="${OFFICE_REL}/styles" Target="styles.xml"/>`,
    );
    expect(resolveWorksheetPartPaths(entries)).toEqual([SHEET_PART]);
  });

  it('leaves out a worksheet part no relationship names', () => {
    const entries = entriesOf(SHEET_RELATIONSHIP, { 'xl/worksheets/sheet9.xml': sheet(TWO_ROWS) });
    expect(resolveWorksheetPartPaths(entries)).toEqual([SHEET_PART]);
  });

  it('rejects an archive without workbook rels as CORRUPT_FILE', () => {
    const entries = Object.fromEntries(
      Object.entries(entriesOf(SHEET_RELATIONSHIP)).filter(
        ([name]) => name !== 'xl/_rels/workbook.xml.rels',
      ),
    );
    expect(() => resolveWorksheetPartPaths(entries)).toThrow(
      expect.objectContaining({ code: 'CORRUPT_FILE' }),
    );
  });

  it('rejects workbook rels over MAX_WORKBOOK_RELS_BYTES before parsing them', () => {
    const entries = entriesOf(`${SHEET_RELATIONSHIP}<!--${'x'.repeat(MAX_WORKBOOK_RELS_BYTES)}-->`);
    expect(() => resolveWorksheetPartPaths(entries)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
    );
  });

  it('rejects workbook rels that are not well-formed as CORRUPT_FILE', () => {
    const entries = entriesOf(SHEET_RELATIONSHIP);
    entries['xl/_rels/workbook.xml.rels'] = strToU8('<Relationships>');
    expect(() => resolveWorksheetPartPaths(entries)).toThrow(
      expect.objectContaining({ code: 'CORRUPT_FILE' }),
    );
  });
});

describe('grid gate: reader parts', () => {
  it('leaves out an XML part no workbook relationship names, whatever it holds', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: sheet(TWO_ROWS) }], {
      'xl/custom/notes.xml': `<notes><dimension ref="${FORGED_REF}"/></notes>`,
      'xl/custom/broken.xml': '<notes><open></notes>',
    });

    const names = readerPartNames(file);

    expect(names).not.toContain('xl/custom/notes.xml');
    expect(names).not.toContain('xl/custom/broken.xml');
    expect(gateOutcome(file)).toBeNull();
  });

  it('rejects a part the reader opens that is not well-formed', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: sheet(TWO_ROWS) }], {
      'xl/_rels/workbook.xml.rels': SHARED_STRINGS_RELS,
      'xl/sharedStrings.xml': '<sst><open></sst>',
    });
    expect(gateOutcome(file)).toBe('CORRUPT_FILE');
  });

  it('leaves out every entry the reader never opens', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: sheet(TWO_ROWS) }], {
      'xl/media/image1.png': 'binary',
      'xl/printerSettings/printerSettings1.bin': 'binary',
    });

    const names = readerPartNames(file);

    expect(names).not.toContain('xl/media/image1.png');
    expect(names).not.toContain('xl/printerSettings/printerSettings1.bin');
    expect(names).not.toContain('_rels/.rels');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
  });

  it('ignores the dimension of every part that carries sheetData, whatever its path', () => {
    const file = buildXlsxFixture([
      { name: 'A', xml: sheet(`<dimension ref="A1"/>${TWO_ROWS}`) },
      {
        name: 'B',
        xml: sheet(`<dimension ref="${FORGED_REF}"/>${TWO_ROWS}`),
        partPath: 'xl/custom/s.xml',
        relTarget: 'custom/s.xml',
      },
    ]);

    expect(uploadOutcome(file, { sheetName: 'A' })).toEqual(grid(TWO_ROW_GRID));
    expect(uploadOutcome(file, { sheetName: 'B' })).toEqual(grid(TWO_ROW_GRID));
  });

  it('reads an uncached formula cell as empty, whatever its prefix, type and style', () => {
    const xml =
      `${XML_DECLARATION}<x:worksheet${X_PREFIX_NS}><x:sheetData><x:row r="1">` +
      '<x:c r="A1" s="42" t="str"><x:f>IF(ISBLANK(B1),"","Hayir")</x:f></x:c>' +
      '<x:c r="B1" t="inlineStr"><x:is><x:t>keep</x:t></x:is></x:c>' +
      '</x:row></x:sheetData></x:worksheet>';
    const file = buildXlsxFixture([{ name: 'Sheet1', xml }]);

    expect(uploadOutcome(file)).toEqual(grid([[null, 'keep']]));
  });
});

/** Workbook rels pointing at sheet1 and at a styles part. */
const STYLES_RELS =
  `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId9" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
  `</Relationships>`;

function stylesXml(formatCodes: readonly string[], root = 'styleSheet'): string {
  const numFmts = formatCodes
    .map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${code}"/>`)
    .join('');
  const xfs = formatCodes.map((_, i) => `<xf numFmtId="${164 + i}"/>`).join('');
  return (
    `${XML_DECLARATION}<${root} xmlns="${SPREADSHEET_NS}"><numFmts>${numFmts}</numFmts>` +
    `<cellXfs><xf numFmtId="0"/>${xfs}</cellXfs></${root}>`
  );
}

/** One row: cell i (column A, B, ...) holds SERIAL_DATE styled with format i. */
function styledWorkbook(formatCodes: readonly string[], root?: string): Buffer {
  const cells = formatCodes
    .map((_, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i + 1}"><v>${SERIAL_DATE}</v></c>`)
    .join('');
  return buildXlsxFixture(
    [{ name: 'Sheet1', xml: sheet(`<sheetData><row r="1">${cells}</row></sheetData>`) }],
    { 'xl/_rels/workbook.xml.rels': STYLES_RELS, [STYLES_PART]: stylesXml(formatCodes, root) },
  );
}

describe('grid gate: number formats', () => {
  // The reader does not check the root name of the part its styles relationship
  // points at, so the format codes count whatever the root is named.
  it('reads the format codes of a styles part whatever its root is named', () => {
    const file = styledWorkbook(['dd.mm.yyyy', '0.00'], 'notStyles');
    expect(uploadOutcome(file)).toEqual(grid([[SERIAL_DATE_AS_DATE, SERIAL_DATE]]));
  });

  it('rejects a format code longer than Excel allows as UNSAFE_CONTENT', async () => {
    const file = styledWorkbook(['0'.repeat(MAX_FORMAT_CODE_LENGTH + 1)]);
    expect(await readOutcome(file)).toEqual(rejected('UNSAFE_CONTENT'));
  });

  it('accepts a format code at the Excel limit', async () => {
    const file = styledWorkbook(['0'.repeat(MAX_FORMAT_CODE_LENGTH)]);
    expect(await readOutcome(file)).toEqual(grid([[SERIAL_DATE]]));
  });
});

describe('grid gate: a broken styles part', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // In-process (readUploadGrid), so the console spies see every write the read
  // path could make.
  it('is rejected as CORRUPT_FILE without writing to the console', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['Barkod'], ['X1']]) }], {
      'xl/_rels/workbook.xml.rels': STYLES_RELS,
      [STYLES_PART]: `<styleSheet xmlns="${SPREADSHEET_NS}">${'<1x/>'.repeat(100)}<cellXfs><xf/></cellXfs></styleSheet>`,
    });

    expect(uploadOutcome(file)).toEqual(rejected('CORRUPT_FILE'));
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
