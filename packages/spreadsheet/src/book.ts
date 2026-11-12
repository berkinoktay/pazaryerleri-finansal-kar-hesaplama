import type { Element, Node } from '@xmldom/xmldom';

import { ReaderRuleError, trimmedOrNull } from './cell-value';
import { BUILTIN_DATE_FORMAT_IDS, isReaderDateFormat } from './date-format';
import { attributeOf, childElements, firstChildNamed, localName, textOf } from './xml-dom';

// What the grid reader needs from the workbook's book-level parts, extracted by
// read-excel-file 9.2.0's exact rules (reader contract, sections 1 and 3): elements by
// local name among DIRECT children only, first match; attributes by exact qualified
// name. Every input that reader throws on throws ReaderRuleError here.

const SHEETS = 'sheets';
const SHEET = 'sheet';
const WORKBOOK_PROPERTIES = 'workbookPr';
const SHARED_STRING_ITEM = 'si';
const TEXT = 't';
const RUN = 'r';
const NUMBER_FORMATS = 'numFmts';
const NUMBER_FORMAT = 'numFmt';
const CELL_FORMATS = 'cellXfs';
const CELL_FORMAT = 'xf';
const NAME_ATTRIBUTE = 'name';
const RELATION_ID_ATTRIBUTE = 'r:id';
const DATE_1904_ATTRIBUTE = 'date1904';
const DATE_1904_ON = '1';
const NUMBER_FORMAT_ID_ATTRIBUTE = 'numFmtId';
const FORMAT_CODE_ATTRIBUTE = 'formatCode';
// The reader collects number formats in an array keyed by id (parseStyles.js):
// assigning a format to the key 'length' sets the array's length to an object, which
// throws a RangeError, so such a styles part fails the whole read.
const ARRAY_LENGTH_KEY = 'length';

/** One named `<sheet>` of the workbook, in document order. */
export interface SheetEntry {
  readonly name: string;
  /** The attribute named literally `r:id`, or null. */
  readonly relationId: string | null;
}

function childrenNamed(parent: Node, name: string): Element[] {
  return childElements(parent).filter((child) => localName(child.tagName) === name);
}

/**
 * The sheet list and date system of `xl/workbook.xml` (parseSpreadsheetInfo.js): the
 * direct `sheet` children of the first direct `sheets` that have a non-empty `name`
 * (a missing `sheets` throws), and the 1904 system only when the first direct
 * `workbookPr` has `date1904` exactly '1'.
 */
export function extractWorkbook(root: Element): {
  readonly sheets: readonly SheetEntry[];
  readonly epoch1904: boolean;
} {
  const sheetList = firstChildNamed(root, SHEETS);
  if (sheetList === null) throw new ReaderRuleError('Workbook has no sheets element');
  const sheets: SheetEntry[] = [];
  for (const sheet of childrenNamed(sheetList, SHEET)) {
    const name = attributeOf(sheet, NAME_ATTRIBUTE);
    if (name === null || name === '') continue;
    sheets.push({ name, relationId: attributeOf(sheet, RELATION_ID_ATTRIBUTE) });
  }
  const properties = firstChildNamed(root, WORKBOOK_PROPERTIES);
  const epoch1904 =
    properties !== null && attributeOf(properties, DATE_1904_ATTRIBUTE) === DATE_1904_ON;
  return { sheets, epoch1904 };
}

/**
 * The shared strings of the root of a shared strings part, trimmed-or-null
 * (xml/xlsx.js getSharedStrings): per direct `si`, the text of its first direct `t`;
 * without one, the texts of the first direct `t` of every direct `r`, joined (a run
 * without `t` throws). Phonetic runs and `xml:space` are ignored.
 */
export function extractSharedStrings(root: Element): (string | null)[] {
  const strings: (string | null)[] = [];
  for (const item of childrenNamed(root, SHARED_STRING_ITEM)) {
    const text = firstChildNamed(item, TEXT);
    if (text !== null) {
      strings.push(trimmedOrNull(textOf(text)));
      continue;
    }
    const runs: string[] = [];
    for (const run of childrenNamed(item, RUN)) {
      const runText = firstChildNamed(run, TEXT);
      if (runText === null) throw new ReaderRuleError('Shared string run has no text');
      runs.push(textOf(runText));
    }
    strings.push(trimmedOrNull(runs.join('')));
  }
  return strings;
}

/** formatCode by numFmtId, from the first direct `numFmts`; a later duplicate id wins. */
function numberFormatIsDate(root: Element): Map<string, boolean> {
  const isDate = new Map<string, boolean>();
  const numFmts = firstChildNamed(root, NUMBER_FORMATS);
  if (numFmts === null) return isDate;
  for (const numFmt of childrenNamed(numFmts, NUMBER_FORMAT)) {
    // A missing id is the key 'null', as in the reader's array.
    const id = String(attributeOf(numFmt, NUMBER_FORMAT_ID_ATTRIBUTE));
    if (id === ARRAY_LENGTH_KEY) throw new ReaderRuleError('Number format id breaks the reader');
    // Classified once per format, not once per xf that points at it: an xf count
    // times a format length would otherwise be quadratic work.
    const template = attributeOf(numFmt, FORMAT_CODE_ATTRIBUTE);
    isDate.set(id, template !== null && template !== '' && isReaderDateFormat(template));
  }
  return isDate;
}

/**
 * Per entry of the first direct `cellXfs` of a styles root, whether it formats a
 * date (parseStyles.js, isDateFormatStyle.js): an `xf` without numFmtId is not a
 * date; a numFmtId whose Number is a built-in date id is one, even when a custom
 * numFmt redefines that id; otherwise its custom formatCode decides. `cellStyleXfs`
 * are not inherited (the reader's xfId lookup reads a property that does not exist).
 */
export function extractXfIsDate(root: Element): boolean[] {
  const formatIsDate = numberFormatIsDate(root);
  const cellXfs = firstChildNamed(root, CELL_FORMATS);
  if (cellXfs === null) return [];
  return childrenNamed(cellXfs, CELL_FORMAT).map((xf) => {
    const id = attributeOf(xf, NUMBER_FORMAT_ID_ATTRIBUTE);
    if (id === null) return false;
    if (BUILTIN_DATE_FORMAT_IDS.has(Number(id))) return true;
    return formatIsDate.get(id) ?? false;
  });
}
