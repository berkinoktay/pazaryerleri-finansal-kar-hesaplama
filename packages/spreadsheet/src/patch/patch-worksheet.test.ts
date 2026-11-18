import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../../tests/helpers/errors';
import {
  clear,
  MAIN_NAMESPACE,
  num,
  patchWorksheetXml,
  sheet,
  text,
} from '../../tests/helpers/patch-helpers';
import { expectWithinBudget, LINEAR_BUDGET_MS } from '../../tests/helpers/timing';
import type { SpreadsheetFileErrorCode } from '../errors';
import { cellKey, columnLetters } from '../sheet-meta';
import { parsePart } from '../xml-dom';
import type { CellPatch, CellPatchValue } from './patch-request';
import { applyCellPatches, patchedPartCap, type WorksheetPatchOptions } from './patch-worksheet';
import { MALFORMED_SHEET_REASONS, PATCH_LIMIT_REASONS } from './reasons';
import { cellKeysOf, indexWorksheet } from './sheet-index';
import { valueAt } from './xml-lexer';

const decoder = new TextDecoder();

const PART_ENTRY = 'xl/worksheets/sheet1.xml';
const SHEET_DATA_OPEN = '<sheetData>';
const SHEET_DATA_CLOSE = '</sheetData>';
// Binds the prefix `x` to the main namespace next to the default namespace.
const PREFIXED_ROOT = `xmlns="${MAIN_NAMESPACE}" xmlns:x="${MAIN_NAMESPACE}"`;
const NO_FORMULA_COLUMNS: ReadonlySet<number> = new Set();
const NO_DATE_STYLES: readonly boolean[] = [];
const UNBOUNDED: WorksheetPatchOptions = {
  overwriteFormulaColumns: NO_FORMULA_COLUMNS,
  maxBytes: Number.MAX_SAFE_INTEGER,
  dateStyles: NO_DATE_STYLES,
};
// A cellXfs date table: entry 7 formats a date, entry 3 (a '0.00' style) does not.
const DATE_STYLE = 7;
const NUMBER_STYLE = 3;
const DATE_STYLES: readonly boolean[] = Array.from(
  { length: DATE_STYLE + 1 },
  (_, style) => style === DATE_STYLE,
);

const PRECONDITION_COLUMNS = 6;
const MISSING_ROW_COUNT = 12;
const LONG_VALUE_LENGTH = 40;
const LINEAR_ROWS = 20_000;
const LINEAR_COLUMNS = 30;
const LINEAR_TEST_TIMEOUT_MS = 120_000;
// The self-closing-row shape below: its source, its cap and its result, in bytes.
const SELF_CLOSING_SOURCE_BYTES = 309_044;
const SELF_CLOSING_CAP_BYTES = 463_566;
const SELF_CLOSING_RESULT_BYTES = 917_938;

/** Cells A to F of `row`, each holding a value. */
function cellsAToF(row: number): string {
  return Array.from(
    { length: PRECONDITION_COLUMNS },
    (_, column) => `<c r="${columnLetters(column + 1)}${row}"><v>1</v></c>`,
  ).join('');
}

const ROWS_2_AND_3 = `<row r="2">${cellsAToF(2)}</row><row r="3">${cellsAToF(3)}</row>`;
const TWO_ROWS = '<row r="1"><c r="A1"/></row><row r="2"><c r="A2"/></row>';

/** The part as text, after it parsed with the engine's strict parser. */
function wellFormed(bytes: Uint8Array): string {
  const xml = decoder.decode(bytes);
  parsePart(PART_ENTRY, xml);
  return xml;
}

/** The text between `<sheetData>` and `</sheetData>`. */
function sheetDataOf(xml: string): string {
  const start = xml.indexOf(SHEET_DATA_OPEN);
  const end = xml.lastIndexOf(SHEET_DATA_CLOSE);
  if (start === -1 || end === -1) throw new Error('The part has no sheetData element');
  return xml.slice(start + SHEET_DATA_OPEN.length, end);
}

/** The sheet data of `patchWorksheetXml(sheet(body), ...)`; the patched part must parse strictly. */
function patched(
  body: string,
  patches: readonly CellPatch[],
  flagged?: readonly number[],
  rootAttributes?: string,
  dateStyles?: readonly boolean[],
): string {
  return sheetDataOf(
    wellFormed(patchWorksheetXml(sheet(body, rootAttributes), patches, flagged, dateStyles)),
  );
}

function capped(maxBytes: number, dateStyles = NO_DATE_STYLES): WorksheetPatchOptions {
  return { overwriteFormulaColumns: NO_FORMULA_COLUMNS, maxBytes, dateStyles };
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

/** Runs `work` and asserts it stayed within the linear budget (enforced in CI). */
function timed<T>(work: () => T): T {
  const started = performance.now();
  const result = work();
  expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
  return result;
}

describe('applyCellPatches: precondition', () => {
  const part = sheet(ROWS_2_AND_3);
  const cases: readonly (readonly [string, readonly CellPatch[]])[] = [
    ['a number value that would inject markup', [num(2, 1, '1</v><f>1</f><v>')]],
    ['rows out of order', [num(3, 0, '1'), num(2, 0, '1')]],
    ['columns out of order inside one row', [num(2, 5, '1'), num(2, 2, '1')]],
    ['the same cell twice', [num(2, 1, '1'), num(2, 1, '2')]],
    ['a fractional column', [num(2, 1.5, '1')]],
    ['a column past the last one', [num(2, 256, '1')]],
    ['row 0', [num(0, 0, '1')]],
    ['a text value holding NUL', [text(2, 1, '\u0000')]],
  ];

  it.each(cases)('throws before writing anything for %s', (_, patches) => {
    expect(() => patchWorksheetXml(part, patches)).toThrow('Invalid patch request');
  });

  it('checks a patch that follows one on a missing row', () => {
    expect(() => patchWorksheetXml(part, [num(9, 0, '1'), num(9, 1, '1</v>')])).toThrow(
      'Invalid patch request',
    );
  });

  it('checks a patch that follows a rejected formula target', () => {
    const formulaRow = sheet('<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>');
    expect(() => patchWorksheetXml(formulaRow, [num(2, 0, '1'), num(2, 1, '1</v>')])).toThrow(
      'Invalid patch request',
    );
  });

  it('writes the value it checked when a getter answers differently on a second read', () => {
    let reads = 0;
    const shifty: CellPatch = {
      excelRow: 2,
      col: 0,
      get value(): CellPatchValue {
        reads += 1;
        return reads === 1
          ? { kind: 'number', value: '1' }
          : { kind: 'number', value: '1</v></c><c r="Z9"><f>EVIL()</f></c><c r="A2"><v>1' };
      },
    };
    const out = sheetDataOf(wellFormed(patchWorksheetXml(sheet(ROWS_2_AND_3), [shifty])));
    expect(out).not.toContain('EVIL');
    expect(out.startsWith('<row r="2"><c r="A2"><v>1</v></c><c r="B2">')).toBe(true);
  });
});

describe('applyCellPatches: order of errors', () => {
  const formulaRow = '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>';

  it('reports a missing row before a formula target', () => {
    expectFileError(
      () => patchWorksheetXml(sheet(formulaRow), [num(2, 0, '5'), num(9, 0, '1')]),
      'ROW_NOT_FOUND',
      { count: 1, rows: [9] },
    );
  });

  it('reports a shared formula before a plain unflagged formula', () => {
    const body =
      '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>2</v></c></row>';
    expectFileError(
      () => patchWorksheetXml(sheet(body), [num(2, 0, '5'), num(2, 1, '6')]),
      'MALFORMED_SHEET',
      { reason: MALFORMED_SHEET_REASONS.SHARED_FORMULA, count: 1, rows: [2] },
    );
  });

  it('checks the growth cap after a missing row', () => {
    const part = sheet('<row r="2"><c r="A2"/></row>');
    expectFileError(
      () =>
        applyCellPatches(
          indexWorksheet(part),
          [num(2, 0, '1234'), num(9, 0, '1')],
          capped(part.length),
        ),
      'ROW_NOT_FOUND',
      { count: 1, rows: [9] },
    );
  });

  it('checks the final size, so a clear makes room for a later insert', () => {
    const part = sheet(
      `<row r="2"><c r="A2"><v>${'1'.repeat(LONG_VALUE_LENGTH)}</v></c></row><row r="3"></row>`,
    );
    const result = applyCellPatches(
      indexWorksheet(part),
      [clear(2, 0), num(3, 0, '5')],
      capped(part.length),
    );
    expect(sheetDataOf(wellFormed(result.bytes))).toBe(
      '<row r="2"><c r="A2"/></row><row r="3"><c r="A3"><v>5</v></c></row>',
    );
    // The insert alone would not fit.
    expectFileError(
      () => applyCellPatches(indexWorksheet(part), [num(3, 0, '5')], capped(part.length)),
      'PAYLOAD_TOO_LARGE',
      { reason: PATCH_LIMIT_REASONS.GROWTH, cap: part.length },
    );
  });

  it('stops at once when the added bytes alone exceed the cap, even before a missing row', () => {
    const part = sheet('<row r="2"><c r="B2"/></row>');
    expectFileError(
      () => applyCellPatches(indexWorksheet(part), [num(2, 1, '5'), num(9, 0, '1')], capped(10)),
      'PAYLOAD_TOO_LARGE',
      { reason: PATCH_LIMIT_REASONS.GROWTH, cap: 10 },
    );
  });
});

describe('applyCellPatches: existing cells', () => {
  it('writes a number into an empty cell and keeps its style', () => {
    expect(patched('<row r="2"><c r="B2" s="7"></c></row>', [num(2, 1, '12.50')])).toBe(
      '<row r="2"><c r="B2" s="7"><v>12.50</v></c></row>',
    );
  });

  it('opens a self-closing cell', () => {
    expect(patched('<row r="2"><c r="B2" s="7"/></row>', [num(2, 1, '1')])).toBe(
      '<row r="2"><c r="B2" s="7"><v>1</v></c></row>',
    );
  });

  it('replaces a shared string with an inline string', () => {
    expect(patched('<row r="2"><c r="I2" t="s"><v>17</v></c></row>', [text(2, 8, 'Yes')])).toBe(
      '<row r="2"><c r="I2" t="inlineStr"><is><t>Yes</t></is></c></row>',
    );
  });

  it('keeps every attribute but t, vm and cm verbatim and in order', () => {
    expect(
      patched('<row r="2"><c r="B2" s="7" cm="1" foo="a&amp;b" t="n"><v>3</v></c></row>', [
        num(2, 1, '4'),
      ]),
    ).toBe('<row r="2"><c r="B2" s="7" foo="a&amp;b"><v>4</v></c></row>');
  });

  it('drops the value metadata vm of the replaced content, and keeps x:vm and xmlns:vm', () => {
    expect(
      patched(
        '<row r="2"><c r="B2" s="7" vm="1" xmlns:x="urn:x" x:vm="2" xmlns:vm="urn:vm" t="e">' +
          '<v>#VALUE!</v></c></row>',
        [num(2, 1, '4')],
      ),
    ).toBe(
      '<row r="2"><c r="B2" s="7" xmlns:x="urn:x" x:vm="2" xmlns:vm="urn:vm"><v>4</v></c></row>',
    );
  });

  it("writes the children of an overwritten cell with the cell's own prefix", () => {
    expect(
      patched(
        '<row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c></row>',
        [num(2, 0, '5'), num(2, 1, '6')],
        undefined,
        PREFIXED_ROOT,
      ),
    ).toBe('<row r="2"><x:c r="A2"><x:v>5</x:v></x:c><c r="B2"><v>6</v></c></row>');
    expect(
      patched(
        '<row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c></row>',
        [text(2, 0, 'y')],
        undefined,
        PREFIXED_ROOT,
      ),
    ).toBe('<row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>y</x:t></x:is></x:c></row>');
  });

  it('copies each kept attribute from its name through its closing quote', () => {
    expect(
      patched(`<row r="2"><c r="B2"\n  s = '7'\tfoo="a>b"  t="s" ><v>1</v></c></row>`, [
        num(2, 1, '5'),
      ]),
    ).toBe(`<row r="2"><c r="B2" s = '7' foo="a>b"><v>5</v></c></row>`);
  });

  it('drops only the attribute named exactly t, whatever its quoting and spacing', () => {
    expect(
      patched(`<row r="2"><c r="B2" t = 's' xmlns:t="urn:t" t:t="x"><v>3</v></c></row>`, [
        num(2, 1, '4'),
      ]),
    ).toBe('<row r="2"><c r="B2" xmlns:t="urn:t" t:t="x"><v>4</v></c></row>');
  });

  it('clears a cell to a self-closing tag', () => {
    expect(patched('<row r="2"><c r="B2" s="7" t="n"><v>3</v></c></row>', [clear(2, 1)])).toBe(
      '<row r="2"><c r="B2" s="7"/></row>',
    );
  });
});

describe('applyCellPatches: date styles', () => {
  const DATE_CELL = `<row r="2"><c r="B2" s="${DATE_STYLE}"><v>45000</v></c></row>`;

  /** `patched` with the date table DATE_STYLES. */
  function dated(body: string, patches: readonly CellPatch[], flagged?: readonly number[]): string {
    return patched(body, patches, flagged, undefined, DATE_STYLES);
  }

  it('drops a date style under a number', () => {
    expect(dated(DATE_CELL, [num(2, 1, '12.50')])).toBe(
      '<row r="2"><c r="B2"><v>12.50</v></c></row>',
    );
  });

  it('keeps a style that does not format a date under a number', () => {
    expect(
      dated(`<row r="2"><c r="B2" s="${NUMBER_STYLE}"><v>1</v></c></row>`, [num(2, 1, '12.50')]),
    ).toBe(`<row r="2"><c r="B2" s="${NUMBER_STYLE}"><v>12.50</v></c></row>`);
  });

  it('drops s and t, keeps every other attribute in order, whatever the quoting', () => {
    expect(
      dated(`<row r="2"><c r="B2" foo="a&amp;b" s = '7' t="n" bar="z"><v>3</v></c></row>`, [
        num(2, 1, '4'),
      ]),
    ).toBe('<row r="2"><c r="B2" foo="a&amp;b" bar="z"><v>4</v></c></row>');
  });

  it('keeps a date style under text and under a clear', () => {
    expect(dated(DATE_CELL, [text(2, 1, 'x')])).toBe(
      `<row r="2"><c r="B2" s="${DATE_STYLE}" t="inlineStr"><is><t>x</t></is></c></row>`,
    );
    expect(dated(DATE_CELL, [clear(2, 1)])).toBe(`<row r="2"><c r="B2" s="${DATE_STYLE}"/></row>`);
  });

  it('keeps a prefixed s', () => {
    expect(
      dated('<row r="2"><c r="B2" xmlns:x="urn:x" x:s="7"><v>1</v></c></row>', [num(2, 1, '4')]),
    ).toBe('<row r="2"><c r="B2" xmlns:x="urn:x" x:s="7"><v>4</v></c></row>');
  });

  it('keeps a style written with a character reference, or empty', () => {
    expect(
      dated('<row r="2"><c r="B2" s="&#55;"><v>1</v></c><c r="C2" s=""><v>1</v></c></row>', [
        num(2, 1, '4'),
        num(2, 2, '5'),
      ]),
    ).toBe('<row r="2"><c r="B2" s="&#55;"><v>4</v></c><c r="C2" s=""><v>5</v></c></row>');
  });

  it("keeps a style index beyond the table's length", () => {
    expect(
      dated('<row r="2"><c r="B2" s="8"><v>1</v></c><c r="C2" s="70"><v>1</v></c></row>', [
        num(2, 1, '4'),
        num(2, 2, '5'),
      ]),
    ).toBe('<row r="2"><c r="B2" s="8"><v>4</v></c><c r="C2" s="70"><v>5</v></c></row>');
  });

  it('drops a date style from a formula cell it overwrites in a flagged column', () => {
    expect(
      dated(
        '<row r="2"><c r="R2" s="7"><f>A1</f><v>45000</v></c></row>',
        [num(2, 17, '15.4')],
        [17],
      ),
    ).toBe('<row r="2"><c r="R2"><v>15.4</v></c></row>');
  });

  it('sizes the part without the dropped style, to the byte', () => {
    const before = `${DATE_CELL}<row r="3"><c r="A3" s="${DATE_STYLE}"/></row>`;
    const after =
      '<row r="2"><c r="B2"><v>12.50</v></c></row><row r="3"><c r="A3"><v>1</v></c></row>';
    const part = sheet(before);
    const patches = [num(2, 1, '12.50'), num(3, 0, '1')];
    const expected = part.length - before.length + after.length;

    const fits = applyCellPatches(indexWorksheet(part), patches, capped(expected, DATE_STYLES));

    expect(fits.bytes).toHaveLength(expected);
    expect(sheetDataOf(wellFormed(fits.bytes))).toBe(after);
    expectFileError(
      () => applyCellPatches(indexWorksheet(part), patches, capped(expected - 1, DATE_STYLES)),
      'PAYLOAD_TOO_LARGE',
      { reason: PATCH_LIMIT_REASONS.GROWTH, cap: expected - 1 },
    );
  });
});

describe('applyCellPatches: formulas', () => {
  const formulaCell = '<row r="2"><c r="R2" s="40" t="n"><f>=1+1</f><v>0.0</v></c></row>';

  it('overwrites a formula in a flagged column and counts it', () => {
    const part = sheet(formulaCell);
    const result = applyCellPatches(indexWorksheet(part), [num(2, 17, '15.4')], {
      overwriteFormulaColumns: new Set([17]),
      maxBytes: patchedPartCap(part.length),
      dateStyles: NO_DATE_STYLES,
    });
    expect(sheetDataOf(wellFormed(result.bytes))).toBe(
      '<row r="2"><c r="R2" s="40"><v>15.4</v></c></row>',
    );
    expect(result.changed).toBe(true);
    expect(result.formulasRemoved).toBe(1);
  });

  it('refuses a formula in an unflagged column', () => {
    expectFileError(
      () => patchWorksheetXml(sheet(formulaCell), [num(2, 17, '15.4')]),
      'MALFORMED_SHEET',
      { reason: MALFORMED_SHEET_REASONS.FORMULA_TARGET, count: 1, rows: [2] },
    );
  });

  it('counts every refused formula cell and lists each row once', () => {
    const body =
      '<row r="2"><c r="A2"><f>1</f></c><c r="B2"><f>1</f></c><c r="C2"><f>1</f></c></row>' +
      '<row r="4"><c r="A4"><f>1</f></c></row>';
    expectFileError(
      () =>
        patchWorksheetXml(sheet(body), [
          num(2, 0, '1'),
          num(2, 1, '1'),
          num(2, 2, '1'),
          num(4, 0, '1'),
        ]),
      'MALFORMED_SHEET',
      { reason: MALFORMED_SHEET_REASONS.FORMULA_TARGET, count: 4, rows: [2, 4] },
    );
  });

  it('refuses a shared formula even in a flagged column', () => {
    expectFileError(
      () =>
        patchWorksheetXml(
          sheet('<row r="2"><c r="R2"><f t="shared" si="0"/><v>1</v></c></row>'),
          [num(2, 17, '5')],
          [17],
        ),
      'MALFORMED_SHEET',
      { reason: MALFORMED_SHEET_REASONS.SHARED_FORMULA, count: 1, rows: [2] },
    );
  });

  it('finds a prefixed formula', () => {
    const body = '<row r="2"><c r="R2"><x:f>1+1</x:f><v>2</v></c></row>';
    expectFileError(
      () => patchWorksheetXml(sheet(body, PREFIXED_ROOT), [num(2, 17, '5')]),
      'MALFORMED_SHEET',
      { reason: MALFORMED_SHEET_REASONS.FORMULA_TARGET, count: 1, rows: [2] },
    );
    expect(patched(body, [num(2, 17, '5')], [17], PREFIXED_ROOT)).toBe(
      '<row r="2"><c r="R2"><v>5</v></c></row>',
    );
  });

  it('does not take an f nested below a direct child for a formula', () => {
    const part = sheet('<row r="2"><c r="R2"><extLst><f/></extLst><v>1</v></c></row>');
    const result = applyCellPatches(indexWorksheet(part), [num(2, 17, '2')], UNBOUNDED);
    expect(sheetDataOf(wellFormed(result.bytes))).toBe('<row r="2"><c r="R2"><v>2</v></c></row>');
    expect(result.formulasRemoved).toBe(0);
  });
});

describe('applyCellPatches: inserts', () => {
  it('keeps edits in order across self-closing and open rows', () => {
    expect(
      patched('<row r="2"/><row r="3"><c r="A3"/></row><row r="4"/>', [
        num(2, 0, '1'),
        num(3, 1, '2'),
        num(4, 0, '3'),
      ]),
    ).toBe(
      '<row r="2"><c r="A2"><v>1</v></c></row><row r="3"><c r="A3"/><c r="B3"><v>2</v></c></row>' +
        '<row r="4"><c r="A4"><v>3</v></c></row>',
    );
  });

  it('inserts before the first cell with a greater column', () => {
    expect(patched('<row r="2"><c r="A2"/><c r="C2"/></row>', [num(2, 1, '5')])).toBe(
      '<row r="2"><c r="A2"/><c r="B2"><v>5</v></c><c r="C2"/></row>',
    );
  });

  it('inserts a text cell after the last cell', () => {
    expect(patched('<row r="2"><c r="A2"/></row>', [text(2, 2, 'x')])).toBe(
      '<row r="2"><c r="A2"/><c r="C2" t="inlineStr"><is><t>x</t></is></c></row>',
    );
  });

  it('keeps two inserts at one offset in column order', () => {
    expect(patched('<row r="2"><c r="C2"/></row>', [num(2, 0, '5'), num(2, 1, '6')])).toBe(
      '<row r="2"><c r="A2"><v>5</v></c><c r="B2"><v>6</v></c><c r="C2"/></row>',
    );
  });

  it('inserts into an empty row', () => {
    expect(patched('<row r="2"></row>', [num(2, 0, '5')])).toBe(
      '<row r="2"><c r="A2"><v>5</v></c></row>',
    );
  });

  it('inserts after the last cell, before other children', () => {
    expect(patched('<row r="2"><c r="A2"/><extLst/></row>', [num(2, 1, '5')])).toBe(
      '<row r="2"><c r="A2"/><c r="B2"><v>5</v></c><extLst/></row>',
    );
  });

  it('opens a self-closing row', () => {
    expect(patched('<row r="2" customFormat="1"/>', [text(2, 1, 'x')])).toBe(
      '<row r="2" customFormat="1"><c r="B2" t="inlineStr"><is><t>x</t></is></c></row>',
    );
    expect(patched('<row r="2" />', [num(2, 0, '1')])).toBe(
      '<row r="2" ><c r="A2"><v>1</v></c></row>',
    );
  });

  it('opens a self-closing row once for several new cells', () => {
    expect(patched('<row r="2"/>', [num(2, 0, '1'), text(2, 2, 'x')])).toBe(
      '<row r="2"><c r="A2"><v>1</v></c><c r="C2" t="inlineStr"><is><t>x</t></is></c></row>',
    );
  });

  it("uses the row's prefix for the new cell", () => {
    expect(
      patched('<x:row r="2"><x:c r="A2"/></x:row>', [num(2, 1, '5')], undefined, PREFIXED_ROOT),
    ).toBe('<x:row r="2"><x:c r="A2"/><x:c r="B2"><x:v>5</x:v></x:c></x:row>');
  });

  it('writes the reference of 0-based column 27 (Excel column 28) as AB', () => {
    expect(patched('<row r="2"></row>', [num(2, 27, '1')])).toBe(
      '<row r="2"><c r="AB2"><v>1</v></c></row>',
    );
  });
});

describe('applyCellPatches: kept verbatim', () => {
  it('keeps comments, processing instructions, CDATA and whitespace of a row', () => {
    expect(
      patched('<row r="2"> <!--k--><c r="A2"/><?p q?><![CDATA[z]]>\n</row>', [num(2, 0, '1')]),
    ).toBe('<row r="2"> <!--k--><c r="A2"><v>1</v></c><?p q?><![CDATA[z]]>\n</row>');
  });

  it('leaves every byte before the first edit and after the last edit as it was', () => {
    const part = sheet(
      '<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>' +
        '<row r="3"><c r="A3"><v>3</v></c><c r="C3"/></row>',
    );
    const index = indexWorksheet(part);
    // The overwrite of A3 starts the edits; the insert before C3 ends them.
    const firstEdit = valueAt(index.cellStart, 2);
    const lastEditEnd = valueAt(index.cellStart, 3);
    const output = patchWorksheetXml(part, [num(3, 0, '7'), num(3, 1, '8')]);
    wellFormed(output);
    expect(output.subarray(0, firstEdit)).toEqual(part.subarray(0, firstEdit));
    const tailLength = part.length - lastEditEnd;
    expect(output.subarray(output.length - tailLength)).toEqual(part.subarray(lastEditEnd));
    expect(sheetDataOf(decoder.decode(output))).toContain(
      '<row r="3"><c r="A3"><v>7</v></c><c r="B3"><v>8</v></c><c r="C3"/></row>',
    );
  });
});

describe('applyCellPatches: text', () => {
  const row = '<row r="2"><c r="A2"/></row>';

  it('escapes the text and preserves its edge spaces', () => {
    expect(patched(row, [text(2, 0, ' a<b&c> ')])).toBe(
      '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve"> a&lt;b&amp;c&gt; </t></is></c></row>',
    );
  });

  it('writes a formula-looking text as the inline string it is', () => {
    expect(patched(row, [text(2, 0, "=cmd|' /C calc'!A0")])).toBe(
      `<row r="2"><c r="A2" t="inlineStr"><is><t>=cmd|' /C calc'!A0</t></is></c></row>`,
    );
  });

  it('writes tabs, line feeds and astral characters as they are', () => {
    expect(patched(row, [text(2, 0, 'a\tb\nc')])).toBe(
      '<row r="2"><c r="A2" t="inlineStr"><is><t>a\tb\nc</t></is></c></row>',
    );
    expect(patched(row, [text(2, 0, '\u{1F600}')])).toBe(
      '<row r="2"><c r="A2" t="inlineStr"><is><t>\u{1F600}</t></is></c></row>',
    );
  });

  it('round-trips non-ASCII text through UTF-8', () => {
    // Built from code units so the source file stays ASCII: A, u-umlaut, g-breve, dotless i.
    const value = String.fromCharCode(0x41, 0xfc, 0x11f, 0x131);
    expect(patched(row, [text(2, 0, value)])).toBe(
      `<row r="2"><c r="A2" t="inlineStr"><is><t>${value}</t></is></c></row>`,
    );
  });
});

describe('applyCellPatches: nothing to do', () => {
  it('returns the source bytes for an empty patch list', () => {
    const index = indexWorksheet(sheet(TWO_ROWS));
    const result = applyCellPatches(index, [], UNBOUNDED);
    expect(result.bytes).toBe(index.bytes);
    expect(result.changed).toBe(false);
    expect(result.formulasRemoved).toBe(0);
  });

  it('returns the source bytes for a clear of an absent cell', () => {
    const index = indexWorksheet(sheet(TWO_ROWS));
    const result = applyCellPatches(index, [clear(2, 3)], UNBOUNDED);
    expect(result.bytes).toBe(index.bytes);
    expect(result.changed).toBe(false);
    expect(result.formulasRemoved).toBe(0);
  });
});

describe('applyCellPatches: missing rows', () => {
  const part = sheet(TWO_ROWS);

  it('lists every missing row', () => {
    expectFileError(
      () => patchWorksheetXml(part, [num(3, 0, '1'), num(9, 0, '1')]),
      'ROW_NOT_FOUND',
      { count: 2, rows: [3, 9] },
    );
  });

  it('counts every missing row and lists the first ten', () => {
    const patches = Array.from({ length: MISSING_ROW_COUNT }, (_, position) =>
      num(position + 3, 0, '1'),
    );
    expectFileError(() => patchWorksheetXml(part, patches), 'ROW_NOT_FOUND', {
      count: MISSING_ROW_COUNT,
      rows: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
  });

  it('counts a clear on a missing row', () => {
    expectFileError(() => patchWorksheetXml(part, [clear(5, 0)]), 'ROW_NOT_FOUND', {
      count: 1,
      rows: [5],
    });
  });

  it('counts patches and lists distinct rows', () => {
    expectFileError(
      () => patchWorksheetXml(part, [num(9, 0, '1'), num(9, 1, '2')]),
      'ROW_NOT_FOUND',
      { count: 2, rows: [9] },
    );
  });
});

describe('applyCellPatches: growth cap', () => {
  // The early exit fires at the first new cell past the cap, before the walk reaches
  // the invalid second patch: the same in a self-closing row as in an open one.
  it.each(['<row r="2"/>', '<row r="2"></row>'])(
    'stops at the first new cell past maxBytes in %s',
    (row) => {
      const patches = [text(2, 0, 'x'.repeat(LONG_VALUE_LENGTH)), num(2, 1, '1</v>')];
      expectFileError(
        () => applyCellPatches(indexWorksheet(sheet(row)), patches, capped(LONG_VALUE_LENGTH)),
        'PAYLOAD_TOO_LARGE',
        { reason: PATCH_LIMIT_REASONS.GROWTH, cap: LONG_VALUE_LENGTH },
      );
    },
  );

  it('computes the cap from the source size', () => {
    expect(patchedPartCap(1_000)).toBe(66_536);
    expect(patchedPartCap(1_000_000)).toBe(1_500_000);
  });

  it('refuses a result one byte above maxBytes and accepts one equal to it', () => {
    const part = sheet('<row r="2"><c r="A2"/></row>');
    const patches = [text(2, 0, 'abc'), num(2, 1, '5')];
    const size = applyCellPatches(indexWorksheet(part), patches, UNBOUNDED).bytes.length;
    expectFileError(
      () => applyCellPatches(indexWorksheet(part), patches, capped(size - 1)),
      'PAYLOAD_TOO_LARGE',
      { reason: PATCH_LIMIT_REASONS.GROWTH, cap: size - 1 },
    );
    const fits = applyCellPatches(indexWorksheet(part), patches, capped(size));
    expect(wellFormed(fits.bytes)).toHaveLength(size);
  });
});

describe('applyCellPatches: linear time', { timeout: LINEAR_TEST_TIMEOUT_MS }, () => {
  /** 20 000 self-closing rows, and one number patch on column A of each. */
  function selfClosingRows(): { readonly part: Uint8Array; readonly patches: CellPatch[] } {
    const rows = Array.from({ length: LINEAR_ROWS }, (_, position) => `<row r="${position + 1}"/>`);
    const patches = Array.from({ length: LINEAR_ROWS }, (_, position) => num(position + 1, 0, '1'));
    return { part: sheet(rows.join('')), patches };
  }

  it('applies 40 000 patches to 20 000 rows of 30 cells', () => {
    const letters = Array.from({ length: LINEAR_COLUMNS }, (_, column) =>
      columnLetters(column + 1),
    );
    const rows = Array.from({ length: LINEAR_ROWS }, (_, position) => {
      const row = position + 1;
      return `<row r="${row}">${letters.map((column) => `<c r="${column}${row}"><v>1</v></c>`).join('')}</row>`;
    });
    const part = sheet(rows.join(''));
    // Per row: an overwrite of column A and an insert after the last cell.
    const patches = Array.from({ length: LINEAR_ROWS }, (_, position) => [
      num(position + 1, 0, '2'),
      num(position + 1, LINEAR_COLUMNS, '3'),
    ]).flat();
    const result = timed(() => applyCellPatches(indexWorksheet(part), patches, UNBOUNDED));
    const index = indexWorksheet(result.bytes);
    expect(index.rowNumber).toHaveLength(LINEAR_ROWS);
    expect(index.cellColumn).toHaveLength(LINEAR_ROWS * (LINEAR_COLUMNS + 1));
  });

  it('opens 20 000 self-closing rows', () => {
    const { part, patches } = selfClosingRows();
    const result = timed(() => applyCellPatches(indexWorksheet(part), patches, UNBOUNDED));
    const index = indexWorksheet(result.bytes);
    expect(index.rowNumber).toHaveLength(LINEAR_ROWS);
    expect(cellKeysOf(index)).toEqual(
      Array.from({ length: LINEAR_ROWS }, (_, position) => cellKey(position + 1, 1)),
    );
    expect(part.length).toBe(SELF_CLOSING_SOURCE_BYTES);
    expect(result.bytes.length).toBe(SELF_CLOSING_RESULT_BYTES);
  });

  it('refuses the same shape at the growth cap', () => {
    const { part, patches } = selfClosingRows();
    expect(patchedPartCap(part.length)).toBe(SELF_CLOSING_CAP_BYTES);
    expectFileError(() => patchWorksheetXml(part, patches), 'PAYLOAD_TOO_LARGE', {
      reason: PATCH_LIMIT_REASONS.GROWTH,
      cap: SELF_CLOSING_CAP_BYTES,
    });
  });
});
