import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

import {
  cellValue,
  isUncachedFormulaCell,
  ReaderRuleError,
  trimmedOrNull,
  type CellContext,
} from './cell-value';
import type { CellValue } from './grid-types';
import { parsePart, textOf, wellFormed } from './xml-dom';

// Every rule below reproduces read-excel-file 9.2.0's parseCellValue.js (see the reader
// contract, section 3). Each cell is parsed from literal XML with the same strict parser
// the reader path uses.

const TEST_PART = 'xl/worksheets/sheet1.xml';
const NO_CONTEXT: CellContext = { sharedStrings: [], xfIsDate: [], epoch1904: false };
const SHARED_STRINGS: CellContext = { sharedStrings: ['x', 'y'], xfIsDate: [], epoch1904: false };
const DATE_STYLES: CellContext = { sharedStrings: [], xfIsDate: [false, true], epoch1904: false };
const DATE_STYLES_1904: CellContext = { ...DATE_STYLES, epoch1904: true };

function cell(xml: string): Element {
  const root = parsePart(TEST_PART, xml).documentElement;
  if (root === null) throw new Error('Test cell XML has no root element');
  return root;
}

function read(xml: string, context: CellContext = NO_CONTEXT): CellValue {
  return cellValue(cell(xml), context);
}

describe('cellValue', () => {
  it('reads an uncached formula cell as null, whatever its type', () => {
    expect(read('<c t="str"><f>A1</f></c>')).toBeNull();
  });

  it('reads a cell without a type, or with an empty one, as a number', () => {
    expect(read('<c><v>5</v></c>')).toBe(5);
    expect(read('<c t=""><v>5</v></c>')).toBe(5);
  });

  it('str: trims the cached value and throws without one', () => {
    expect(read('<c t="str"><f>A1</f><v> x </v></c>')).toBe('x');
    expect(read('<c t="str"><v>  </v></c>')).toBeNull();
    expect(() => read('<c t="str"/>')).toThrow(ReaderRuleError);
  });

  it('inlineStr: trims the text of is/t, empty is null, rich text throws', () => {
    expect(read('<c t="inlineStr"><is><t>  a </t></is></c>')).toBe('a');
    expect(read('<c t="inlineStr"><is><t/></is></c>')).toBeNull();
    expect(() => read('<c t="inlineStr"><is><r><t>x</t></r></is></c>')).toThrow(ReaderRuleError);
    expect(() => read('<c t="inlineStr"><v>x</v><is><t>a</t></is></c>')).toThrow(ReaderRuleError);
    expect(() => read('<c t="inlineStr"/>')).toThrow(ReaderRuleError);
  });

  it('s: reads the shared string at an in-range integer index, else throws', () => {
    expect(read('<c t="s"><v>1</v></c>', SHARED_STRINGS)).toBe('y');
    for (const index of ['2', '-1', '0.5', 'x']) {
      expect(() => read(`<c t="s"><v>${index}</v></c>`, SHARED_STRINGS)).toThrow(ReaderRuleError);
    }
    expect(() => read('<c t="s"/>', SHARED_STRINGS)).toThrow(ReaderRuleError);
  });

  it('b: reads exactly "1" and "0", anything else throws', () => {
    expect(read('<c t="b"><v>1</v></c>')).toBe(true);
    expect(read('<c t="b"><v>0</v></c>')).toBe(false);
    expect(() => read('<c t="b"><v>true</v></c>')).toThrow(ReaderRuleError);
    expect(() => read('<c t="b"/>')).toThrow(ReaderRuleError);
  });

  it('e: prefixes the raw text, untrimmed, even without a value', () => {
    expect(read('<c t="e"><v>#N/A</v></c>')).toBe('#ERROR_#N/A');
    expect(read('<c t="e"><v> #REF! </v></c>')).toBe('#ERROR_ #REF! ');
    expect(read('<c t="e"/>')).toBe('#ERROR_undefined');
  });

  it('z: is null', () => {
    expect(read('<c t="z"><v>1</v></c>')).toBeNull();
  });

  it('d: parses the value with new Date, no value is null, an invalid date throws', () => {
    const iso = '2021-06-10T00:47:45.700Z';
    const parsed = read(`<c t="d"><v>${iso}</v></c>`);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed).toEqual(new Date(iso));
    expect(read('<c t="d"/>')).toBeNull();
    expect(() => read('<c t="d"><v>not a date</v></c>')).toThrow(ReaderRuleError);
    expect(() => read('<c t="d"><v></v></c>')).toThrow(ReaderRuleError);
  });

  it('n: reads the value with Number, NaN throws', () => {
    expect(read('<c t="n"><v>1e3</v></c>')).toBe(1000);
    expect(read('<c t="n"><v>0x10</v></c>')).toBe(16);
    expect(read('<c t="n"><v></v></c>')).toBe(0);
    expect(read('<c t="n"><v> 12 </v></c>')).toBe(12);
    expect(() => read('<c t="n"><v>12abc</v></c>')).toThrow(ReaderRuleError);
  });

  it('looks the style up on every cell, a valueless one included', () => {
    expect(() => read('<c s="9"/>')).toThrow(ReaderRuleError);
    expect(() => read('<c s="9" t="s"/>')).toThrow(ReaderRuleError);
    expect(read('<c s="1"/>', DATE_STYLES)).toBeNull();
  });

  it('n: a date-styled number becomes a UTC Date, shifted for the 1904 system', () => {
    const xml = '<c s="1"><v>45000</v></c>';
    const date = read(xml, DATE_STYLES);
    expect(date).toBeInstanceOf(Date);
    expect(date).toEqual(new Date(Date.UTC(2023, 2, 15)));
    expect(read(xml, DATE_STYLES_1904)).toEqual(new Date(Date.UTC(2027, 2, 16)));
    expect(read('<c s="0"><v>45000</v></c>', DATE_STYLES)).toBe(45000);
    expect(() => read('<c s="1"><v>soon</v></c>', DATE_STYLES)).toThrow(ReaderRuleError);
  });

  it('n: a style index that is not a canonical in-range integer throws, an empty one is ignored', () => {
    expect(() => read('<c s="01"><v>1</v></c>', DATE_STYLES)).toThrow(ReaderRuleError);
    expect(() => read('<c s="5"><v>1</v></c>', DATE_STYLES)).toThrow(ReaderRuleError);
    expect(() => read('<c s="length"><v>1</v></c>', DATE_STYLES)).toThrow(ReaderRuleError);
    expect(() => read('<c s="1"><v>1</v></c>')).toThrow(ReaderRuleError);
    expect(read('<c s=""><v>7</v></c>', DATE_STYLES)).toBe(7);
  });

  it('throws on any other cell type', () => {
    expect(() => read('<c t="x"><v>1</v></c>')).toThrow(ReaderRuleError);
  });

  it('reads a lone surrogate character reference as U+FFFD', () => {
    expect(read('<c t="inlineStr"><is><t>&#xD800;</t></is></c>')).toBe('\uFFFD');
  });
});

describe('isUncachedFormulaCell', () => {
  it('is true only for a formula without a cached value', () => {
    expect(isUncachedFormulaCell(cell('<c><f>A1</f></c>'))).toBe(true);
    expect(isUncachedFormulaCell(cell('<c><f>A1</f><v>1</v></c>'))).toBe(false);
    expect(isUncachedFormulaCell(cell('<c><v>1</v></c>'))).toBe(false);
    expect(isUncachedFormulaCell(cell('<c/>'))).toBe(false);
  });
});

describe('trimmedOrNull', () => {
  it('trims and turns an empty result into null', () => {
    expect(trimmedOrNull(' a ')).toBe('a');
    expect(trimmedOrNull(' ﻿')).toBeNull();
    expect(trimmedOrNull('')).toBeNull();
  });
});

describe('wellFormed', () => {
  it('leaves a valid surrogate pair unchanged', () => {
    expect(wellFormed('a\uD83D\uDE00b')).toBe('a\uD83D\uDE00b');
  });

  it('replaces every unpaired surrogate with U+FFFD', () => {
    expect(wellFormed('\uD800')).toBe('\uFFFD');
    expect(wellFormed('a\uDC00b\uD83D')).toBe('a\uFFFDb\uFFFD');
    expect(wellFormed('\uDE00\uD83D')).toBe('\uFFFD\uFFFD');
  });
});

describe('textOf', () => {
  it('keeps the halves of a surrogate pair split by a comment apart, as the old reader did', () => {
    expect(read('<c t="inlineStr"><is><t>a&#xD83D;<!--c-->&#xDE00;b</t></is></c>')).toBe(
      'a\uFFFD\uFFFDb',
    );
  });

  it('keeps them apart across a processing instruction or a child element too', () => {
    expect(textOf(cell('<t>a&#xD83D;<?pi x?>&#xDE00;b</t>'))).toBe('a\uFFFD\uFFFDb');
    expect(textOf(cell('<t>a&#xD83D;<y>&#xDE00;</y>b</t>'))).toBe('a\uFFFD\uFFFDb');
  });

  it('keeps a pair that sits inside one text node', () => {
    expect(textOf(cell('<t>a&#xD83D;&#xDE00;b</t>'))).toBe('a\uD83D\uDE00b');
  });

  it('reads descendant text and CDATA in document order and skips comments', () => {
    expect(textOf(cell('<t>a<![CDATA[<b>]]>&amp;<!--c-->z<y>q</y></t>'))).toBe('a<b>&zq');
  });
});
