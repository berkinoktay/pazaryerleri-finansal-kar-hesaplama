// Locks the byte patcher against BOTH the unprefixed worksheet XML the other
// verticals' fixtures happen to use AND the NAMESPACE-PREFIXED (`<x:worksheet>`,
// `<x:row>`, `<x:c>`) shape real Trendyol İndirimler exports ship. The prefixed
// case is a regression guard: matching with unprefixed tag regexes silently
// patched nothing, so the seller's chosen rows never became "Evet".
//
// We build the minimal zip the patcher needs (it only unzips `xl/worksheets/*.xml`)
// via fflate and inspect the re-zipped worksheet XML directly, so the assertions can
// pin the exact prefixed OOXML the patched cell must emit.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';

const SHEET = 'xl/worksheets/sheet1.xml';

function toZip(worksheetXml: string): Buffer {
  return Buffer.from(zipSync({ [SHEET]: strToU8(worksheetXml) }));
}

function worksheetOf(zip: Buffer): string {
  const bytes = unzipSync(new Uint8Array(zip))[SHEET];
  if (bytes === undefined) throw new Error('worksheet entry missing');
  return strFromU8(bytes);
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
});
