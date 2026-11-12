import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, type Unzipped } from 'fflate';
import { describe, expect, it } from 'vitest';

import { assertSafeXmlContent, isXmlPart } from './content-scan';
import { SpreadsheetFileError } from './errors';

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';

// Real Trendyol exports committed under apps/api/tests/fixtures; a seller's normal
// file must never trip the content scan.
const API_FIXTURES: readonly string[] = [
  'trendyol-commission-tariff.xlsx',
  'trendyol-tariff-1period.xlsx',
  'trendyol-plus-tariff.xlsx',
  'trendyol-plus-tariff-3ve4.xlsx',
  'trendyol-discount-products.xlsx',
  'trendyol-flash-products.xlsx',
  'trendyol-advantage-tariff.xlsx',
  'marketplace-campaign-sample.xlsx',
];

function readFixture(file: string): Buffer {
  return readFileSync(new URL(`../../../apps/api/tests/fixtures/${file}`, import.meta.url));
}

function worksheetWithText(text: string, prolog = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>${prolog}<worksheet xmlns="${SPREADSHEET_NS}">` +
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row>` +
    `</sheetData></worksheet>`
  );
}

function entriesOf(parts: Readonly<Record<string, string>>): Unzipped {
  const out: Unzipped = {};
  for (const [path, text] of Object.entries(parts)) out[path] = strToU8(text);
  return out;
}

// Returns the SpreadsheetFileError the scan throws, null when it passes, and
// re-throws anything unexpected.
function scanError(entries: Unzipped): SpreadsheetFileError | null {
  try {
    assertSafeXmlContent(entries);
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
}

describe('assertSafeXmlContent', () => {
  it('rejects a DOCTYPE', () => {
    const upper = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('x', '<!DOCTYPE worksheet>') }),
    );
    expect(upper?.code).toBe('UNSAFE_CONTENT');
    expect(upper?.meta).toEqual({ entry: SHEET_PART });

    const lower = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('x', '<!doctype worksheet>') }),
    );
    expect(lower?.code).toBe('UNSAFE_CONTENT');
  });

  it('rejects an ENTITY declaration', () => {
    const err = scanError(
      entriesOf({
        [WORKBOOK_RELS_PART]: '<?xml version="1.0"?><!ENTITY lol "lol"><Relationships/>',
      }),
    );
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({ entry: WORKBOOK_RELS_PART });
  });

  it('rejects an unknown entity reference (&xxe;)', () => {
    const err = scanError(entriesOf({ [SHEET_PART]: worksheetWithText('&xxe;') }));
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({ entry: SHEET_PART });
  });

  it('accepts the five predefined and numeric references', () => {
    const err = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('&amp;&lt;&gt;&quot;&apos;&#304;&#x130;') }),
    );
    expect(err).toBeNull();
  });

  it('accepts all eight api fixtures', () => {
    for (const file of API_FIXTURES) {
      expect(scanError(unzipSync(new Uint8Array(readFixture(file)))), file).toBeNull();
    }
  });
});

describe('isXmlPart', () => {
  // The gate keeps exactly the entries ending in .xml or .xml.rels.
  it.each([
    ['[Content_Types].xml', true],
    ['xl/worksheets/sheet1.xml', true],
    ['xl/_rels/workbook.xml.rels', true],
    ['_rels/.rels', false],
    ['xl/media/image1.png', false],
    ['xl/worksheets/sheet1.XML', false],
  ])('%s -> %s', (name, expected) => {
    expect(isXmlPart(name)).toBe(expected);
  });
});
