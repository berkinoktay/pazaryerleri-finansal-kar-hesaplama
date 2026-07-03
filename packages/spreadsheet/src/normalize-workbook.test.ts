import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { normalizeWorkbookForRead } from './normalize-workbook';

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

describe('normalizeWorkbookForRead', () => {
  it('removes a single-cell <dimension> from worksheet xml', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><dimension ref="A1"/><sheetData><row r="1"/></sheetData></worksheet>',
      'xl/sharedStrings.xml': '<sst count="0"/>',
    });

    const out = normalizeWorkbookForRead(buf);

    expect(entryText(out, 'xl/worksheets/sheet1.xml')).not.toContain('<dimension');
    // Non-worksheet entries are preserved verbatim.
    expect(entryText(out, 'xl/sharedStrings.xml')).toBe('<sst count="0"/>');
  });

  it('strips the dimension across multiple worksheets', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1"/></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><dimension ref="B2"/></worksheet>',
    });

    const out = normalizeWorkbookForRead(buf);

    expect(entryText(out, 'xl/worksheets/sheet1.xml')).not.toContain('<dimension');
    expect(entryText(out, 'xl/worksheets/sheet2.xml')).not.toContain('<dimension');
  });

  it('leaves a proper range <dimension> untouched (returns the original buffer)', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:AF56"/><sheetData/></worksheet>',
    });

    // No single-cell dimension → no rewrite → same buffer reference (no re-zip).
    expect(normalizeWorkbookForRead(buf)).toBe(buf);
  });

  it('returns the original buffer for a non-zip input', () => {
    const buf = Buffer.from('not a zip at all');
    expect(normalizeWorkbookForRead(buf)).toBe(buf);
  });

  it('neutralizes an uncached-formula cell to an empty cell', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1">' +
        '<c r="A1" s="42" t="str"><f>=IF(ISBLANK(B1),"","Hayir")</f></c>' +
        '</row></sheetData></worksheet>',
    });

    const out = normalizeWorkbookForRead(buf);
    const xml = entryText(out, 'xl/worksheets/sheet1.xml');
    expect(xml).not.toContain('<f>');
    expect(xml).not.toContain('t="str"');
    expect(xml).toContain('<c r="A1" s="42"/>');
  });

  it('preserves a formula cell that carries a cached value', () => {
    const buf = makeZip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1">' +
        '<c r="A1"><f>=1+1</f><v>2</v></c>' +
        '</row></sheetData></worksheet>',
    });

    // Has a cached <v> → untouched → same buffer reference (no re-zip).
    expect(normalizeWorkbookForRead(buf)).toBe(buf);
  });

  it('does NOT swallow a cached-value formula cell that precedes an uncached one', () => {
    // Regression: the İptal helper column (uncached formula) sits AFTER two
    // cached-value formula cells on every row. A cross-cell regex would collapse
    // all three into one empty cell, deleting the cached values.
    const buf = makeZip({
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="2">' +
        '<c r="R2" t="n"><f>=X2</f><v>0.0</v></c>' + // cached — MUST survive
        '<c r="S2" t="n"><f>=Y2</f><v>15.4</v></c>' + // cached — MUST survive
        '<c r="T2" t="str"><f>=IF(ISBLANK(Q2),"","Hayir")</f></c>' + // uncached — neutralized
        '<c r="U2" t="inlineStr"><is><t>keep</t></is></c>' + // plain — untouched
        '</row></sheetData></worksheet>',
    });

    const xml = entryText(normalizeWorkbookForRead(buf), 'xl/worksheets/sheet1.xml');
    // The two cached values are preserved verbatim.
    expect(xml).toContain('<c r="R2" t="n"><f>=X2</f><v>0.0</v></c>');
    expect(xml).toContain('<c r="S2" t="n"><f>=Y2</f><v>15.4</v></c>');
    // Only the uncached formula cell collapsed to empty.
    expect(xml).toContain('<c r="T2"/>');
    expect(xml).not.toContain('IF(ISBLANK');
    // The plain inline-string cell is untouched.
    expect(xml).toContain('<is><t>keep</t></is>');
  });
});
