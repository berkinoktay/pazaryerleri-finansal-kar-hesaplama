import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { stripWorksheetDimensions } from './normalize-workbook';

function makeZip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(files)) entries[name] = strToU8(xml);
  return Buffer.from(zipSync(entries));
}

function entryText(buf: Buffer, name: string): string {
  const entries = unzipSync(new Uint8Array(buf));
  const bytes = entries[name];
  if (bytes === undefined) throw new Error(`entry missing: ${name}`);
  return strFromU8(bytes);
}

describe('stripWorksheetDimensions', () => {
  it('removes a single-cell <dimension> from worksheet xml', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><dimension ref="A1"/><sheetData><row r="1"/></sheetData></worksheet>',
      'xl/sharedStrings.xml': '<sst count="0"/>',
    });

    const out = stripWorksheetDimensions(buf);

    expect(entryText(out, 'xl/worksheets/sheet1.xml')).not.toContain('<dimension');
    // Non-worksheet entries are preserved verbatim.
    expect(entryText(out, 'xl/sharedStrings.xml')).toBe('<sst count="0"/>');
  });

  it('strips the dimension across multiple worksheets', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1"/></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><dimension ref="B2"/></worksheet>',
    });

    const out = stripWorksheetDimensions(buf);

    expect(entryText(out, 'xl/worksheets/sheet1.xml')).not.toContain('<dimension');
    expect(entryText(out, 'xl/worksheets/sheet2.xml')).not.toContain('<dimension');
  });

  it('leaves a proper range <dimension> untouched (returns the original buffer)', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:AF56"/><sheetData/></worksheet>',
    });

    // No single-cell dimension → no rewrite → same buffer reference (no re-zip).
    expect(stripWorksheetDimensions(buf)).toBe(buf);
  });

  it('returns the original buffer for a non-zip input', () => {
    const buf = Buffer.from('not a zip at all');
    expect(stripWorksheetDimensions(buf)).toBe(buf);
  });
});
