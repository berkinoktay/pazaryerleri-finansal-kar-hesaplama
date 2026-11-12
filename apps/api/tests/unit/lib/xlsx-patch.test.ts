// Locks the byte patcher against BOTH the unprefixed worksheet XML the other
// verticals' fixtures happen to use AND the NAMESPACE-PREFIXED (`<x:worksheet>`,
// `<x:row>`, `<x:c>`) shape real Trendyol İndirimler exports ship. The prefixed
// case is a regression guard: matching with unprefixed tag regexes silently
// patched nothing, so the seller's chosen rows never became "Evet".
//
// We build the minimal zip the patcher needs (the workbook rels plus the worksheet
// they name; it patches only those) via fflate and inspect the re-zipped worksheet
// XML directly, so the assertions can pin the exact prefixed OOXML the patched cell
// must emit.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { buildXlsxFixture } from '@pazarsync/spreadsheet/testing';
import { syncLog } from '@pazarsync/sync-core';

import { ConflictError } from '@/lib/errors';
import {
  columnIndex,
  columnLetter,
  findCellSpans,
  findRowSpans,
  patchXlsxCells,
  type XlsxCellValue,
} from '@/lib/xlsx-patch';

// Fixed, row-free detail the client receives when the stored file and the export
// plan disagree; the row numbers go to the server log only.
const ROWS_MISMATCH_DETAIL = 'Stored workbook rows do not match the export plan';

/** Swallows the mismatch warning so it neither clutters the run nor escapes the spy. */
function silenceWarn(): MockInstance<typeof syncLog.warn> {
  return vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

const SHEET = 'xl/worksheets/sheet1.xml';
const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels';
// Workbook rels naming sheet1 only, the way the reader resolves it (`xl/` + Target).
const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
  'Target="worksheets/sheet1.xml"/></Relationships>';

function toZip(worksheetXml: string, extra: Readonly<Record<string, string>> = {}): Buffer {
  const files: Record<string, Uint8Array> = {
    [WORKBOOK_RELS]: strToU8(WORKBOOK_RELS_XML),
    [SHEET]: strToU8(worksheetXml),
  };
  for (const [name, text] of Object.entries(extra)) files[name] = strToU8(text);
  return Buffer.from(zipSync(files));
}

function entryOf(zip: Buffer, name: string): string {
  const bytes = unzipSync(new Uint8Array(zip))[name];
  if (bytes === undefined) throw new Error(`entry missing: ${name}`);
  return strFromU8(bytes);
}

function worksheetOf(zip: Buffer): string {
  return entryOf(zip, SHEET);
}

function patches(
  rowNum: number,
  colIdx: number,
  value: XlsxCellValue,
): ReadonlyMap<number, ReadonlyMap<number, XlsxCellValue>> {
  return new Map([[rowNum, new Map([[colIdx, value]])]]);
}

// A prefixed worksheet: root declares `xmlns:x`, so EVERY element (down to <x:is>/<x:t>)
// carries the `x:` prefix — the shape real Trendyol İndirimler files use.
const PREFIXED_WS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<x:sheetData>' +
  '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Barkod</x:t></x:is></x:c>' +
  '<x:c r="B1" t="inlineStr"><x:is><x:t>Kampayaya Dahil Edilsin Mi?</x:t></x:is></x:c></x:row>' +
  '<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>BC-1</x:t></x:is></x:c>' +
  '<x:c r="B2" t="inlineStr"><x:is><x:t>Hayır</x:t></x:is></x:c></x:row>' +
  '</x:sheetData></x:worksheet>';

// An unprefixed worksheet with a default namespace — the shape the other verticals'
// fixtures use. Kept to prove the prefix support does not regress them.
const UNPREFIXED_WS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<sheetData>' +
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Barkod</t></is></c>' +
  '<c r="B1" t="inlineStr"><is><t>Kampayaya Dahil Edilsin Mi?</t></is></c></row>' +
  '<row r="2"><c r="A2" t="inlineStr"><is><t>BC-1</t></is></c>' +
  '<c r="B2" t="inlineStr"><is><t>Hayır</t></is></c></row>' +
  '</sheetData></worksheet>';

describe('patchXlsxCells — namespace-prefixed worksheets', () => {
  it('patches an inline-string cell in a prefixed worksheet, mirroring the x: prefix', () => {
    const out = worksheetOf(
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 1, { kind: 'inlineStr', value: 'Evet' })),
    );

    // The chosen cell now says "Evet" AND every emitted tag carries the source prefix,
    // otherwise the <is>/<t> children reference an undeclared namespace (broken XML).
    expect(out).toContain('<x:c r="B2" t="inlineStr"><x:is><x:t>Evet</x:t></x:is></x:c>');
    // No unprefixed cell was emitted for the patched ref.
    expect(out).not.toContain('<c r="B2"');
    expect(out).not.toContain('<is><t>Evet</t></is>');
  });

  it('leaves the other cells and the header row byte-for-byte in a prefixed worksheet', () => {
    const out = worksheetOf(
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 1, { kind: 'inlineStr', value: 'Evet' })),
    );

    // Untouched sibling cell in the patched row stays verbatim (prefix intact).
    expect(out).toContain('<x:c r="A2" t="inlineStr"><x:is><x:t>BC-1</x:t></x:is></x:c>');
    // The row wrapper keeps its prefix on both the open and close tags.
    expect(out).toContain('<x:row r="2">');
    expect(out).toContain('</x:row>');
    // The header row is not in the patch map, so it is copied through unchanged.
    expect(out).toContain(
      '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Barkod</x:t></x:is></x:c>' +
        '<x:c r="B1" t="inlineStr"><x:is><x:t>Kampayaya Dahil Edilsin Mi?</x:t></x:is></x:c></x:row>',
    );
  });

  it('emits a prefixed numeric <x:v> cell in a prefixed worksheet', () => {
    const out = worksheetOf(
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 0, { kind: 'number', value: '42' })),
    );
    expect(out).toContain('<x:c r="A2"><x:v>42</x:v></x:c>');
    expect(out).not.toContain('<c r="A2"><v>42</v></c>');
  });

  it('still patches an unprefixed worksheet (no regression for the other verticals)', () => {
    const out = worksheetOf(
      patchXlsxCells(toZip(UNPREFIXED_WS), patches(2, 1, { kind: 'inlineStr', value: 'Evet' })),
    );
    expect(out).toContain('<c r="B2" t="inlineStr"><is><t>Evet</t></is></c>');
    expect(out).toContain('<c r="A2" t="inlineStr"><is><t>BC-1</t></is></c>');
    expect(out).toContain('</row>');
    // The header row survives untouched.
    expect(out).toContain(
      '<c r="B1" t="inlineStr"><is><t>Kampayaya Dahil Edilsin Mi?</t></is></c>',
    );
  });

  it('emits an unprefixed numeric <v> cell in an unprefixed worksheet', () => {
    const out = worksheetOf(
      patchXlsxCells(toZip(UNPREFIXED_WS), patches(2, 0, { kind: 'number', value: '42' })),
    );
    expect(out).toContain('<c r="A2"><v>42</v></c>');
  });

  // A requested row that no worksheet <row> carries means the patch machinery silently
  // dropped the seller's choice (the "all-Hayır export" bug). The patcher must throw
  // rather than stream back unpatched bytes.
  it('throws when a target row is absent from every worksheet (no silent data loss)', () => {
    silenceWarn();
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(99, 1, { kind: 'inlineStr', value: 'Evet' })),
    ).toThrow(ROWS_MISMATCH_DETAIL);
  });

  it('throws on a partial miss even when some rows matched', () => {
    silenceWarn();
    const rowPatches = new Map([
      [2, new Map([[1, { kind: 'inlineStr', value: 'Evet' } satisfies XlsxCellValue]])],
      [7, new Map([[1, { kind: 'inlineStr', value: 'Evet' } satisfies XlsxCellValue]])],
    ]);
    expect(() => patchXlsxCells(toZip(PREFIXED_WS), rowPatches)).toThrow(ROWS_MISMATCH_DETAIL);
  });

  // A large mismatch must not ship thousands of row numbers to the client: the error
  // detail stays fixed, and the counts plus a short sample of the missing rows go to
  // the server log (no cell content, nothing else from the file).
  it('keeps row numbers out of the error and logs counts with at most 10 unmatched rows', () => {
    const warnSpy = silenceWarn();
    const unmatched = Array.from({ length: 15 }, (_, i) => 100 + i);
    const evet = new Map([[1, { kind: 'inlineStr', value: 'Evet' } satisfies XlsxCellValue]]);
    const rowPatches = new Map([[2, evet]]);
    for (const row of unmatched) rowPatches.set(row, evet);

    let thrown: unknown;
    try {
      patchXlsxCells(toZip(PREFIXED_WS), rowPatches);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ConflictError);
    if (!(thrown instanceof ConflictError)) return;
    expect(thrown.message).toBe(ROWS_MISMATCH_DETAIL);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('xlsx-patch.rows-unmatched', {
      matchedRowCount: 1,
      targetRowCount: 16,
      unmatchedRowSample: unmatched.slice(0, 10),
    });
  });
});

// Only the worksheets the workbook rels name were parsed and bounded by the upload
// gate. A part under xl/worksheets/ that no relationship names was never checked, so
// it may hold anything; the patcher copies it through untouched instead of scanning it.
const UNNAMED_SHEET = 'xl/worksheets/sheet9.xml';
const UNCLOSED_ROW_COUNT = 200_000;
// Loose on purpose: skipping the part takes milliseconds, scanning 200 000 unclosed
// rows with the row regex is quadratic and takes minutes.
// Raised further for parallel test runs (check:all, CI): still far below the minutes
// the quadratic scan takes.
const PATCH_BUDGET_MS = 15_000;

describe('patchXlsxCells — only the worksheets the workbook rels name', { timeout: 60_000 }, () => {
  it('leaves a worksheet the rels do not name byte-for-byte, even with a matching row', () => {
    const zip = toZip(UNPREFIXED_WS, { [UNNAMED_SHEET]: UNPREFIXED_WS });
    const out = patchXlsxCells(zip, patches(2, 1, { kind: 'inlineStr', value: 'Evet' }));
    expect(worksheetOf(out)).toContain('<c r="B2" t="inlineStr"><is><t>Evet</t></is></c>');
    expect(entryOf(out, UNNAMED_SHEET)).toBe(UNPREFIXED_WS);
  });

  it('skips an unnamed worksheet full of unclosed rows in linear time', () => {
    const unclosed = `<worksheet><sheetData>${'<row r="1">'.repeat(UNCLOSED_ROW_COUNT)}`;
    const zip = toZip(UNPREFIXED_WS, { [UNNAMED_SHEET]: unclosed });
    const started = performance.now();
    const out = patchXlsxCells(zip, patches(2, 1, { kind: 'inlineStr', value: 'Evet' }));
    const elapsedMs = performance.now() - started;
    expect(entryOf(out, UNNAMED_SHEET)).toBe(unclosed);
    expect(elapsedMs).toBeLessThan(PATCH_BUDGET_MS);
  });

  it('refuses a target row that only an unnamed worksheet carries', () => {
    silenceWarn();
    const zip = toZip(UNPREFIXED_WS.replace(/<row r="2">[\s\S]*?<\/row>/, ''), {
      [UNNAMED_SHEET]: UNPREFIXED_WS,
    });
    expect(() => patchXlsxCells(zip, patches(2, 1, { kind: 'inlineStr', value: 'Evet' }))).toThrow(
      ConflictError,
    );
  });
});

// The patcher writes values straight into worksheet XML, so anything that is not a
// plain decimal (number cells) or not a legal XML 1.0 character (text cells) would
// either corrupt the file or be read back differently by Trendyol. Both fail before
// any byte is produced.
describe('patchXlsxCells — value validation', () => {
  it('rejects an exponent-notation number', () => {
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 0, { kind: 'number', value: '1e-7' })),
    ).toThrow('invalid number cell value');
  });

  it('rejects NaN', () => {
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 0, { kind: 'number', value: 'NaN' })),
    ).toThrow('invalid number cell value');
  });

  it('rejects a comma decimal', () => {
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 0, { kind: 'number', value: '12,50' })),
    ).toThrow('invalid number cell value');
  });

  it('accepts plain decimal numbers', () => {
    for (const value of ['0', '-0.50', '360.00', '15.4', '1200']) {
      const out = worksheetOf(
        patchXlsxCells(toZip(PREFIXED_WS), patches(2, 0, { kind: 'number', value })),
      );
      expect(out).toContain(`<x:c r="A2"><x:v>${value}</x:v></x:c>`);
    }
  });

  it('rejects a control character in text', () => {
    expect(() =>
      patchXlsxCells(
        toZip(PREFIXED_WS),
        patches(2, 1, { kind: 'inlineStr', value: `Ev${String.fromCharCode(0x01)}et` }),
      ),
    ).toThrow('invalid text cell value');
  });

  it.each([
    ['carriage return', String.fromCharCode(0x0d)],
    ['U+FFFE', String.fromCharCode(0xfffe)],
    ['U+FFFF', String.fromCharCode(0xffff)],
    ['lone high surrogate', String.fromCharCode(0xd800)],
    ['lone low surrogate', String.fromCharCode(0xdc00)],
  ])('rejects a %s in text', (_label, bad) => {
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 1, { kind: 'inlineStr', value: `A${bad}B` })),
    ).toThrow('invalid text cell value');
  });

  it('keeps TAB, LF and astral characters in text', () => {
    const value = `a${String.fromCharCode(0x09)}b${String.fromCharCode(0x0a)}c${String.fromCodePoint(0x1f600)}`;
    const out = worksheetOf(
      patchXlsxCells(toZip(PREFIXED_WS), patches(2, 1, { kind: 'inlineStr', value })),
    );
    expect(out).toContain(`<x:t>${value}</x:t>`);
  });

  it('unmatched rows throw ConflictError', () => {
    silenceWarn();
    expect(() =>
      patchXlsxCells(toZip(PREFIXED_WS), patches(99, 1, { kind: 'inlineStr', value: 'Evet' })),
    ).toThrow(ConflictError);
  });
});

// The patcher's former row and cell regexes, kept verbatim as the oracle the linear
// scanners must agree with. They backtrack: on a part holding many `<row ` (or, inside
// a row, `<c `) starts with no closing tag, every start rescans to the end of the text.
const ROW_RE = /<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>/g;
const CELL_RE = /<(?:\w+:)?c\b[^>]*\/>|<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g;

const FUZZ_SEED = 519;
const FUZZ_CASE_COUNT = 5_000;
const FUZZ_MAX_TOKENS = 14;
const FUZZ_TOKENS = [
  '<row',
  '<x:row',
  '<rowx',
  '<row:x',
  ' r="1"',
  '>',
  '/>',
  '</row>',
  '</x:row>',
  '</row >',
  '<c',
  '<x:c',
  '<cc',
  '</c>',
  '</x:c>',
  '<!--',
  '-->',
  'v',
  ' ',
] as const;

// mulberry32 constants: the state increment and the 2^32 divisor that maps to [0, 1).
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 2 ** 32;

const UNTERMINATED_START_COUNT = 200_000;
const FILLER_LENGTH = 1024 * 1024;
// The linear scanners take milliseconds on these inputs and the regexes take hours,
// so the bound tells the two apart with a wide margin even on a loaded machine.
const LINEAR_SCAN_BUDGET_MS = 2_000;
// The regex oracle only ever runs on this small version of the crafted shape.
const SMALL_START_COUNT = 20;
const SMALL_FILLER_LENGTH = 64;

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** mulberry32: a tiny seeded PRNG, so every run checks the same strings. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + MULBERRY32_INCREMENT) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** FUZZ_CASE_COUNT strings of 0 to FUZZ_MAX_TOKENS tokens each, the same on every run. */
function randomTokenStrings(): string[] {
  const random = mulberry32(FUZZ_SEED);
  const pick = (count: number): number => Math.floor(random() * count);
  return Array.from({ length: FUZZ_CASE_COUNT }, () => {
    let text = '';
    const tokenCount = pick(FUZZ_MAX_TOKENS + 1);
    for (let n = 0; n < tokenCount; n++) text += FUZZ_TOKENS[pick(FUZZ_TOKENS.length)] ?? '';
    return text;
  });
}

/** The spans a global regex matches, as `[start, end]` offsets. */
function regexSpans(text: string, pattern: RegExp): Array<readonly [number, number]> {
  return [...text.matchAll(pattern)].map((m): readonly [number, number] => [
    m.index,
    m.index + m[0].length,
  ]);
}

/** A comment holding `count` unterminated `start` tags followed by filler. */
function startsComment(start: string, count: number, fillerLength: number): string {
  return `<!--${start.repeat(count)}${'x'.repeat(fillerLength)}-->`;
}

/** One real cell, then a comment of unterminated `<c ` starts before the row closes. */
function craftedRow(count: number, fillerLength: number): string {
  return `<row r="1"><c r="A1"><v>1</v></c>${startsComment('<c ', count, fillerLength)}</row>`;
}

/** The crafted row, followed by a comment of unterminated `<row ` starts. */
function craftedSheet(
  count: number,
  fillerLength: number,
): { readonly xml: string; readonly rowComment: string } {
  const rowComment = startsComment('<row ', count, fillerLength);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SPREADSHEET_NS}"><sheetData>` +
    `${craftedRow(count, fillerLength)}${rowComment}</sheetData></worksheet>`;
  return { xml, rowComment };
}

/**
 * The former regex patch path for one number cell of an unprefixed row, run inline as
 * the oracle. Only ever called on the small crafted sheet: on the full one it takes hours.
 */
function regexPatchedWorksheet(xml: string, rowNum: number, colIdx: number, value: string): string {
  return xml.replace(ROW_RE, (rowXml: string) => {
    if (Number(/\br="(\d+)"/.exec(rowXml)?.[1]) !== rowNum) return rowXml;
    const byCol = new Map<number, string>();
    for (const match of rowXml.matchAll(CELL_RE)) {
      const letters = /\br="([A-Z]+)\d+"/.exec(match[0])?.[1];
      if (letters !== undefined) byCol.set(columnIndex(letters), match[0]);
    }
    byCol.set(colIdx, `<c r="${columnLetter(colIdx)}${rowNum}"><v>${value}</v></c>`);
    const openTag = /<(?:\w+:)?row\b[^>]*>/.exec(rowXml)?.[0] ?? '';
    const body = [...byCol.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, cell]) => cell)
      .join('');
    return `${openTag}${body}</row>`;
  });
}

describe('patchXlsxCells — linear row and cell scans', { timeout: 60_000 }, () => {
  it('finds exactly the row spans ROW_RE finds', () => {
    for (const text of randomTokenStrings()) {
      expect(findRowSpans(text), text).toEqual(regexSpans(text, ROW_RE));
    }
  });

  it('finds exactly the cell spans CELL_RE finds', () => {
    for (const text of randomTokenStrings()) {
      expect(findCellSpans(text), text).toEqual(regexSpans(text, CELL_RE));
    }
  });

  it('scans 200 000 unterminated row starts in linear time', () => {
    const { xml } = craftedSheet(UNTERMINATED_START_COUNT, FILLER_LENGTH);
    const rowStart = xml.indexOf('<row r="1">');
    const rowEnd = xml.indexOf('</row>') + '</row>'.length;

    const started = performance.now();
    const spans = findRowSpans(xml);
    const elapsedMs = performance.now() - started;

    expect(spans).toEqual([[rowStart, rowEnd]]);
    expect(elapsedMs).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
  });

  it('scans 200 000 unterminated cell starts in linear time', () => {
    const rowXml = craftedRow(UNTERMINATED_START_COUNT, FILLER_LENGTH);
    const cellStart = rowXml.indexOf('<c r="A1">');
    const cellEnd = rowXml.indexOf('</c>') + '</c>'.length;

    const started = performance.now();
    const spans = findCellSpans(rowXml);
    const elapsedMs = performance.now() - started;

    expect(spans).toEqual([[cellStart, cellEnd]]);
    expect(elapsedMs).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
  });

  it('patches a row of the crafted sheet quickly and identically', () => {
    const rowPatches = patches(1, 1, { kind: 'number', value: '42' });
    const small = craftedSheet(SMALL_START_COUNT, SMALL_FILLER_LENGTH);
    const large = craftedSheet(UNTERMINATED_START_COUNT, FILLER_LENGTH);
    const largeFile = buildXlsxFixture([{ name: 'Sheet1', xml: large.xml }]);

    const started = performance.now();
    const out = patchXlsxCells(largeFile, rowPatches);
    const elapsedMs = performance.now() - started;

    const expectedSmall = regexPatchedWorksheet(small.xml, 1, 1, '42');
    const smallFile = buildXlsxFixture([{ name: 'Sheet1', xml: small.xml }]);
    expect(worksheetOf(patchXlsxCells(smallFile, rowPatches))).toBe(expectedSmall);
    // The patched row keeps only its cells, so its comment goes; the comment after the
    // row is copied through. The large output is therefore the oracle's small output
    // with that trailing comment scaled up.
    expect(worksheetOf(out)).toBe(expectedSmall.replace(small.rowComment, () => large.rowComment));
    expect(elapsedMs).toBeLessThan(LINEAR_SCAN_BUDGET_MS);
  });
});
