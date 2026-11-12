import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BUILTIN_DATE_FORMAT_IDS, excelSerialToDate, isReaderDateFormat } from './date-format';

// A custom number format decides whether a numeric cell reads as a date, so our
// classifier must agree with the old reader's on every input. The old reader's own
// module (9.2.0, modules/xlsx/isDateFormat.js) used to be loaded here and compared
// against ours; its answers were recorded once, from that module, for every input
// below, so the comparison outlives the dependency.

// The old reader's isDateFormat, recorded: format code -> classified as a date.
const READER_DATE_FORMAT_RESULTS: ReadonlyMap<string, boolean> = new Map([
  ['0.00', false],
  ['dd/mm/yyyy', true],
  ['[$-41F]dd.mm.yyyy;@', true],
  ['#,##0.00 "TL"', false],
  ['hh:mm:ss', true],
  ['General', false],
  ['mmm-yy', true],
  ['yyyy-mm-dd hh:mm', true],
  ['', false],
  ['@', false],
  ['yyyy-mm-dd', true],
  ['0', false],
  ['d/m/yyyy', true],
  ['m/d/yy h:mm', true],
  ['h:mm AM/PM', true],
  ['h:mm:ss am/pm', true],
  ['[h]:mm:ss', false],
  ['mm:ss.0', false],
  ['DD.MM.YYYY', true],
  ['[$-414]mmmm\\ yyyy;@', true],
  ['[$-x-sysdate]dddd, mmmm dd, yyyy', false],
  ['[$-404]e/m/d', true],
  ['0%', false],
  ['0.00%', false],
  ['#,##0', false],
  ['$#,##0.00', false],
  ['#,##0.00_);(#,##0.00)', false],
  ['0.00E+00', false],
  ['# ?/?', false],
  ['[Red]0.00', false],
  ['yyyy', true],
  ['dddd', false],
  ['e', true],
  ['am/pm', true],
  ['yyyy-mm-dd;@', true],
  ['[$-tr-TR]d mmmm yyyy', true],
  ['"TL"#,##0', false],
  ['dd/mm/yyyy hh:mm:ss', true],
  ['yyyy"y"m"m"d"d"', false],
  [';@', false],
  ['[$-]yyyy', false],
  [' ', false],
  ['-', false],
  ['mm-dd-yy', true],
  ['dd;@;@', false],
  ['YYYY-MM-DD', true],
  ['_-* #,##0.00 _T_L_-;-* #,##0.00 _T_L_-;_-* "-"?? _T_L_-;_-@_-', false],
]);

/** The recorded reader answer for `code`; throws when no answer was recorded for it. */
function readerIsDateFormat(code: string): boolean {
  const recorded = READER_DATE_FORMAT_RESULTS.get(code);
  if (recorded === undefined) {
    throw new Error(`No recorded reader classification for ${JSON.stringify(code)}`);
  }
  return recorded;
}

const FIXTURE_FILES: readonly string[] = [
  'trendyol-commission-tariff.xlsx',
  'trendyol-tariff-1period.xlsx',
  'trendyol-plus-tariff.xlsx',
  'trendyol-plus-tariff-3ve4.xlsx',
  'trendyol-discount-products.xlsx',
  'trendyol-flash-products.xlsx',
  'trendyol-advantage-tariff.xlsx',
  'marketplace-campaign-sample.xlsx',
];
const STYLES_PART = 'xl/styles.xml';

const HAND_PICKED_FORMAT_CODES: readonly string[] = [
  'dd/mm/yyyy',
  '[$-41F]dd.mm.yyyy;@',
  '0.00',
  '#,##0.00 "TL"',
  'hh:mm:ss',
  'General',
  'mmm-yy',
  'yyyy-mm-dd hh:mm',
  '',
  '@',
  'yyyy-mm-dd',
  '0',
  'd/m/yyyy',
  'm/d/yy h:mm',
  'h:mm AM/PM',
  'h:mm:ss am/pm',
  '[h]:mm:ss',
  'mm:ss.0',
  'DD.MM.YYYY',
  '[$-414]mmmm\\ yyyy;@',
  '[$-x-sysdate]dddd, mmmm dd, yyyy',
  '[$-404]e/m/d',
  '0%',
  '0.00%',
  '#,##0',
  '$#,##0.00',
  '#,##0.00_);(#,##0.00)',
  '0.00E+00',
  '# ?/?',
  '[Red]0.00',
  'yyyy',
  'dddd',
  'e',
  'am/pm',
  'yyyy-mm-dd;@',
  '[$-tr-TR]d mmmm yyyy',
  '"TL"#,##0',
  'dd/mm/yyyy hh:mm:ss',
  'yyyy"y"m"m"d"d"',
  ';@',
  '[$-]yyyy',
  ' ',
  '-',
  'mm-dd-yy',
  'dd;@;@',
  'YYYY-MM-DD',
  '_-* #,##0.00 _T_L_-;-* #,##0.00 _T_L_-;_-* "-"?? _T_L_-;_-@_-',
];

function fixtureFormatCodes(file: string): string[] {
  const bytes = readFileSync(new URL(`../../../apps/api/tests/fixtures/${file}`, import.meta.url));
  const styles = unzipSync(new Uint8Array(bytes))[STYLES_PART];
  if (styles === undefined) return [];
  const doc = new DOMParser().parseFromString(strFromU8(styles), 'text/xml');
  const codes: string[] = [];
  const numFmts = doc.getElementsByTagName('numFmt');
  for (let i = 0; i < numFmts.length; i += 1) {
    const code = numFmts.item(i)?.getAttribute('formatCode') ?? null;
    if (code !== null) codes.push(code);
  }
  return codes;
}

describe('isReaderDateFormat', () => {
  const fixtureCodes = FIXTURE_FILES.flatMap(fixtureFormatCodes);

  it('finds format codes in the fixtures', () => {
    expect(fixtureCodes.length).toBeGreaterThan(0);
  });

  it.each([...fixtureCodes, ...HAND_PICKED_FORMAT_CODES])(
    'agrees with the reader on %j',
    (code) => {
      expect(isReaderDateFormat(code)).toBe(readerIsDateFormat(code));
    },
  );
});

describe('BUILTIN_DATE_FORMAT_IDS', () => {
  it.each([14, 22, 45, 47])('holds the built-in date format id %i', (id) => {
    expect(BUILTIN_DATE_FORMAT_IDS.has(id)).toBe(true);
  });

  it.each([0, 2, 49])('does not hold the non-date format id %i', (id) => {
    expect(BUILTIN_DATE_FORMAT_IDS.has(id)).toBe(false);
  });

  it("holds exactly the reader's built-in date format ids", () => {
    const readerIds = [
      ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47],
      ...[27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58],
      ...[71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81],
    ];
    expect([...BUILTIN_DATE_FORMAT_IDS].sort((a, b) => a - b)).toEqual(
      readerIds.sort((a, b) => a - b),
    );
  });
});

describe('excelSerialToDate', () => {
  it('has no leap-year correction before 1900-03-01', () => {
    expect(excelSerialToDate(59, false).toISOString()).toBe('1900-02-27T00:00:00.000Z');
  });

  it('reads a time-only serial as a UTC wall clock on 1899-12-30', () => {
    expect(excelSerialToDate(0.25, false).toISOString()).toBe('1899-12-30T06:00:00.000Z');
  });
});
