import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DATE_FORMAT_CODE,
  NUMBER_FORMAT_CODE,
  canonicalFormatCode,
  isReaderDateFormat,
} from './date-format';

// The read copy rewrites every custom number format to one of two canonical codes.
// That is only safe if our classifier and the reader's agree on every input, so
// the reader's own module (read-excel-file/modules/xlsx/isDateFormat.js) is loaded
// from its absolute file path and compared against ours.

type DateFormatClassifier = (template: string) => unknown;

interface ClassifierModule {
  readonly default: DateFormatClassifier;
}

function isClassifierModule(value: unknown): value is ClassifierModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'function'
  );
}

const requireFromHere = createRequire(import.meta.url);
const READER_ROOT = dirname(requireFromHere.resolve('read-excel-file/package.json'));
const READER_IS_DATE_FORMAT = join(READER_ROOT, 'modules', 'xlsx', 'isDateFormat.js');

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

let readerIsDateFormat: DateFormatClassifier = () => {
  throw new Error('reader classifier not loaded');
};

beforeAll(async () => {
  const loaded: unknown = await import(pathToFileURL(READER_IS_DATE_FORMAT).href);
  if (!isClassifierModule(loaded)) throw new Error('reader isDateFormat module has no default');
  readerIsDateFormat = loaded.default;
});

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

describe('canonicalFormatCode', () => {
  it('the reader classifies the canonical date code as a date', () => {
    expect(readerIsDateFormat(DATE_FORMAT_CODE)).toBe(true);
  });

  it('the reader classifies the canonical number code as not a date', () => {
    expect(readerIsDateFormat(NUMBER_FORMAT_CODE)).toBe(false);
  });

  it.each(HAND_PICKED_FORMAT_CODES)('keeps the reader classification of %j', (code) => {
    expect(readerIsDateFormat(canonicalFormatCode(code))).toBe(readerIsDateFormat(code));
  });
});
