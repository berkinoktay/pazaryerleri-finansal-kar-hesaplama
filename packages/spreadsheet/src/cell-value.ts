import type { Element, Node } from '@xmldom/xmldom';

import { excelSerialToDate } from './date-format';
import type { CellValue } from './grid-types';
import { attributeOf, firstChildNamed, isElement, localName, textOf } from './xml-dom';

// One worksheet cell (`<c>`) to its grid value, by read-excel-file 9.2.0's exact rules
// (modules/xlsx/parseCell.js and parseCellValue.js; reader contract, section 3):
//   - the type is the `t` attribute, 'n' when it is missing or empty;
//   - the raw value is the text of the first direct `<v>`, undefined without one;
//   - strings are trimmed and an empty string is null;
//   - numbers are read with `Number`, like the reader's parseNumberDefault;
//   - every input the reader throws on throws ReaderRuleError here, so the caller
//     can fall back to the first sheet or report CORRUPT_FILE as the old path did.
// One rule is stricter than that reader: every cell that carries a style index must
// name an existing `cellXfs` entry, an empty cell included (the reader looked the
// style up for a numeric value only). The export patch path keeps a cell's style when
// it writes into it, so a style Excel cannot find must be refused at upload.

const VALUE = 'v';
const FORMULA = 'f';
const INLINE_STRING = 'is';
const INLINE_TEXT = 't';
const TYPE_ATTRIBUTE = 't';
const STYLE_ATTRIBUTE = 's';
const DEFAULT_TYPE = 'n';
const TRUE_VALUE = '1';
const FALSE_VALUE = '0';
// The reader's decodeError compares the raw string with numbers and never matches,
// so every error cell becomes this prefix plus the raw text (`undefined` without one).
const ERROR_VALUE_PREFIX = '#ERROR_';
const MISSING_VALUE_TEXT = 'undefined';
// A style index the reader's `styles[s]` lookup can find is a canonical array index.
const STYLE_INDEX = /^(0|[1-9]\d*)$/;

/** A cell breaks one of the reader's rules. Package-internal: never leaves read-grid.ts. */
export class ReaderRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReaderRuleError';
  }
}

/** What a cell needs from the rest of the workbook. */
export interface CellContext {
  /** Shared strings, already trimmed-or-null, so a cell never re-trims a long string. */
  readonly sharedStrings: readonly (string | null)[];
  /** Per `cellXfs` entry: whether the style formats a date. */
  readonly xfIsDate: readonly boolean[];
  readonly epoch1904: boolean;
}

/** True for a cell with a direct formula child and no direct cached value child. */
export function isUncachedFormulaCell(cell: Element): boolean {
  return firstChildNamed(cell, FORMULA) !== null && firstChildNamed(cell, VALUE) === null;
}

/** `text` trimmed (JS `trim`), or null when nothing is left. */
export function trimmedOrNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function firstElementChild(parent: Node): Element | null {
  for (const child of parent.childNodes) {
    if (isElement(child)) return child;
  }
  return null;
}

function inlineStringValue(cell: Element): string | null {
  const inline = firstElementChild(cell);
  if (inline === null || localName(inline.tagName) !== INLINE_STRING) {
    throw new ReaderRuleError('Unsupported inline string cell structure');
  }
  const text = firstElementChild(inline);
  if (text === null || localName(text.tagName) !== INLINE_TEXT) {
    throw new ReaderRuleError('Unsupported inline string cell structure');
  }
  return trimmedOrNull(textOf(text));
}

function sharedStringValue(raw: string | undefined, context: CellContext): string | null {
  const index = Number(raw ?? Number.NaN);
  const value =
    Number.isInteger(index) && index >= 0 && index < context.sharedStrings.length
      ? context.sharedStrings[index]
      : undefined;
  if (value === undefined) {
    throw new ReaderRuleError('Invalid or out-of-bounds shared string index');
  }
  return value;
}

function booleanValue(raw: string | undefined): boolean {
  if (raw === TRUE_VALUE) return true;
  if (raw === FALSE_VALUE) return false;
  throw new ReaderRuleError('Unsupported boolean cell value');
}

function dateValue(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new ReaderRuleError('Unsupported date cell value');
  return date;
}

function numberOf(raw: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) throw new ReaderRuleError('Invalid numeric cell value');
  return value;
}

/**
 * Whether the cell's style formats a date; a cell without a style index (or with an
 * empty one) has none. A style index that is not a canonical index of an existing
 * `cellXfs` entry throws.
 */
function hasDateStyle(cell: Element, context: CellContext): boolean {
  const style = attributeOf(cell, STYLE_ATTRIBUTE);
  if (style === null || style === '') return false;
  if (!STYLE_INDEX.test(style) || Number(style) >= context.xfIsDate.length) {
    throw new ReaderRuleError('Cell style not found');
  }
  return context.xfIsDate[Number(style)] === true;
}

function numericValue(raw: string | undefined, isDate: boolean, context: CellContext): CellValue {
  if (raw === undefined) return null;
  if (isDate) return excelSerialToDate(numberOf(raw), context.epoch1904);
  return numberOf(raw);
}

/**
 * The grid value of one worksheet cell, by read-excel-file 9.2.0's rules plus the
 * style rule (see the header). Throws ReaderRuleError wherever that reader throws, and
 * for a style index no `cellXfs` entry has, on every cell.
 */
export function cellValue(cell: Element, context: CellContext): CellValue {
  // Looked up before anything else: an empty cell and an uncached formula cell too.
  const isDate = hasDateStyle(cell, context);
  // PR 1's read copy emptied these cells; the old reader then saw an untyped empty cell.
  if (isUncachedFormulaCell(cell)) return null;
  const type = attributeOf(cell, TYPE_ATTRIBUTE) || DEFAULT_TYPE;
  const valueElement = firstChildNamed(cell, VALUE);
  const raw = valueElement === null ? undefined : textOf(valueElement);
  switch (type) {
    case 'str':
      if (raw === undefined) throw new ReaderRuleError('Formula string cell has no value');
      return trimmedOrNull(raw);
    case 'inlineStr':
      return inlineStringValue(cell);
    case 's':
      return sharedStringValue(raw, context);
    case 'b':
      return booleanValue(raw);
    case 'z':
      return null;
    case 'e':
      return ERROR_VALUE_PREFIX + (raw ?? MISSING_VALUE_TEXT);
    case 'd':
      return dateValue(raw);
    case DEFAULT_TYPE:
      return numericValue(raw, isDate, context);
    default:
      throw new ReaderRuleError('Cell type not supported');
  }
}
