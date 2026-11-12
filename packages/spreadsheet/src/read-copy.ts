import { DOMParser, Node, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import { strFromU8, strToU8, type Unzipped } from 'fflate';

import {
  MAX_ERROR_CAUSE_LENGTH,
  MAX_FORMAT_CODE_LENGTH,
  MAX_TOTAL_CELLS,
  MAX_XML_TOTAL_BYTES,
} from './constants';
import { isXmlPart } from './content-scan';
import { canonicalFormatCode } from './date-format';
import { SpreadsheetFileError } from './errors';
import { colRefToNumber } from './sheet-meta';

// Builds the READ copy of an uploaded .xlsx: the entries the grid reader
// (read-excel-file) parses. The stored upload keeps its original bytes.
//
// The copy holds exactly the parts the reader opens. read-excel-file 9.2.0
// (modules/xlsx/parseSpreadsheetContents.js) reads `xl/_rels/workbook.xml.rels` and
// `xl/workbook.xml`, then the Target of every relationship whose Type is exactly the
// styles, sharedStrings or worksheet type, mapped by parseFilePaths.js getFilePath: a
// leading `/` is dropped, otherwise `xl/` is prepended, with no other normalization.
// readerPartPaths below resolves those Targets the same way; the gate hands
// buildReadCopy only those parts. The copy is built from the same DOM the reader
// builds: read-excel-file parses every part with @xmldom/xmldom (modules/xml/xml.js)
// and finds elements by local name among DIRECT children only (modules/xml/xlsx.js):
//   - relationships: documentElement -> each `Relationship`;
//   - cells: documentElement -> first `sheetData` -> each `row` -> each `c`;
//   - grid size: documentElement -> first `dimension`, else the largest cell row
//     times the largest cell column (modules/xlsx/convertCellsToData2dArray.js);
//   - number formats: documentElement -> first `numFmts` -> each `numFmt`, whatever
//     the root is named (modules/xml/xlsx.js getNumberFormats).
// A text (regex) scan cannot see the document that way: a `>` inside an attribute
// value, a comment child, a non-ASCII namespace prefix, a quoted-differently or
// character-referenced `r` all hid a forged dimension or a far-away cell from the
// old regex gate while the reader still honoured it. Walking the reader's own DOM
// closes that gap by construction.
//
// Every part is parsed strictly (anything above a warning is CORRUPT_FILE), then:
//   1. a part whose root has a direct `sheetData` child is a worksheet, whatever
//      its name (the reader resolves sheets from the workbook rels Target, which may
//      name a `.xml.rels` entry):
//      a. more than one direct `dimension` child is CORRUPT_FILE (real files carry
//         at most one); a single one is removed, so the reader sizes the grid from
//         the cells that exist;
//      b. each `row` under the first `sheetData` holds at most
//         ROW_CHILD_NODES_PER_COLUMN x colCap + ROW_CHILD_NODES_SLACK child nodes
//         (text and comments included), and its cells share one row number and go
//         strictly right; otherwise CORRUPT_FILE. This also bounds the cost of each
//         DOM edit in the row;
//      c. every cell carries an exact `r` reference (1-3 column letters, a row
//         without a leading zero); the largest row and column are capped as the
//         cells are walked, before the reader allocates;
//      d. a cell with a formula child and no cached value child is replaced, with
//         one replaceChild, by an empty shallow clone without its `t` attribute:
//         read-excel-file throws on a typed cell without a value (Trendyol's Plus
//         tariff has such helper cells);
//   2. every `numFmt` under a direct `numFmts` child of the root gets a canonical
//      `formatCode` the reader classifies exactly as the original (date-format.ts),
//      so the reader's unbounded date-format cache holds at most two keys; a code
//      longer than Excel's limit is UNSAFE_CONTENT;
//   3. the DOM is serialized back to text. xmldom turns CR, NEL, LS and PS into LF
//      while reading, so in the DOM such a character can only come from a character
//      reference; the serializer writes it raw and the reader would read a LF. Each
//      is written back as a character reference instead;
//   4. the serialized parts together stay within MAX_XML_TOTAL_BYTES: serializing
//      can grow a part (a single-quoted attribute full of `"` grows sixfold).

const XML_MIME_TYPE = 'text/xml';
const SHEET_DATA = 'sheetData';
const DIMENSION = 'dimension';
const ROW = 'row';
const CELL = 'c';
const FORMULA = 'f';
const VALUE = 'v';
const NUMBER_FORMATS = 'numFmts';
const NUMBER_FORMAT = 'numFmt';
const CELL_REF_ATTRIBUTE = 'r';
const CELL_TYPE_ATTRIBUTE = 't';
const FORMAT_CODE_ATTRIBUTE = 'formatCode';
const RELATIONSHIP = 'Relationship';
const RELATIONSHIP_TYPE_ATTRIBUTE = 'Type';
const RELATIONSHIP_TARGET_ATTRIBUTE = 'Target';
const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_RELATIONSHIP_TYPE = `${OFFICE_RELATIONSHIPS}/worksheet`;
// The relationship types whose Target the reader opens (parseFilePaths.js).
const READER_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([
  `${OFFICE_RELATIONSHIPS}/styles`,
  `${OFFICE_RELATIONSHIPS}/sharedStrings`,
  WORKSHEET_RELATIONSHIP_TYPE,
]);
const WORKSHEET_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([WORKSHEET_RELATIONSHIP_TYPE]);
// getFilePath: an absolute Target loses its leading '/', a relative one is under xl/.
const ABSOLUTE_TARGET_PREFIX = '/';
const RELATIVE_TARGET_BASE = 'xl/';

/** The two parts the reader always opens, by these exact names. */
export const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
export const WORKBOOK_PART = 'xl/workbook.xml';
// The only cell reference shape accepted: column letters, then a row number.
const CELL_REF = /^([A-Z]{1,3})([1-9]\d{0,6})$/;
// Child nodes a row may hold per allowed column (the cell plus text or comments
// around it), plus a fixed slack.
const ROW_CHILD_NODES_PER_COLUMN = 4;
const ROW_CHILD_NODES_SLACK = 16;
// Characters xmldom's normalizeLineEndings turns into LF (lib/dom-parser.js).
const READER_NORMALIZED_CHARACTERS = /[\r\u0085\u2028\u2029]/g;

export interface ReadCopyCaps {
  readonly rowCap: number;
  readonly colCap: number;
  /** Callers may LOWER this below MAX_XML_TOTAL_BYTES (e.g. in tests); higher values are clamped. */
  readonly maxXmlBytes?: number;
}

interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/**
 * Local name of an element by read-excel-file's rule: `getTagName` in
 * read-excel-file/modules/xml/dom.js is `element.tagName.replace(/.+\:/, '')`.
 * Same result for every tag name xmldom accepts (a QName: no line break, a colon
 * never first), computed without that regex, which backtracks quadratically on a
 * long name without a colon.
 */
export function localName(tagName: string): string {
  const colon = tagName.lastIndexOf(':');
  return colon > 0 ? tagName.slice(colon + 1) : tagName;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function childElements(parent: Node): Element[] {
  const out: Element[] = [];
  for (const child of parent.childNodes) {
    if (isElement(child)) out.push(child);
  }
  return out;
}

function hasChildNamed(children: readonly Element[], name: string): boolean {
  return children.some((child) => localName(child.tagName) === name);
}

function corruptPart(entry: string, message: string, cause?: unknown): SpreadsheetFileError {
  const meta =
    cause === undefined
      ? { entry }
      : { entry, cause: String(cause).slice(0, MAX_ERROR_CAUSE_LENGTH) };
  return new SpreadsheetFileError('CORRUPT_FILE', message, meta);
}

// Anything above a warning stops the parse: xmldom wraps the throw in a ParseError.
function stopOnError(level: 'warning' | 'error' | 'fatalError', message: string): void {
  if (level !== 'warning') throw new Error(message);
}

function parsePart(entry: string, xml: string): Document {
  try {
    return new DOMParser({ onError: stopOnError }).parseFromString(xml, XML_MIME_TYPE);
  } catch (e) {
    throw corruptPart(entry, 'Workbook part is not well-formed XML', e);
  }
}

function cellPosition(entry: string, cell: Element): CellPosition {
  const ref = cell.getAttribute(CELL_REF_ATTRIBUTE);
  const match = ref === null ? null : CELL_REF.exec(ref);
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) {
    throw corruptPart(entry, 'Cell reference is missing or malformed');
  }
  return { row: Number(digits), col: colRefToNumber(letters) };
}

/** Removes the worksheet's only `dimension`; more than one is CORRUPT_FILE. */
function removeDimension(entry: string, root: Element, rootChildren: readonly Element[]): void {
  let dimension: Element | null = null;
  for (const child of rootChildren) {
    if (localName(child.tagName) !== DIMENSION) continue;
    if (dimension !== null) throw corruptPart(entry, 'Worksheet has more than one dimension');
    dimension = child;
  }
  if (dimension !== null) root.removeChild(dimension);
}

/** Replaces an uncached formula cell with an empty clone of itself, without `t`. */
function emptyUncachedFormulaCell(entry: string, row: Element, cell: Element): void {
  const children = childElements(cell);
  if (!hasChildNamed(children, FORMULA) || hasChildNamed(children, VALUE)) return;
  const empty = cell.cloneNode(false);
  if (!isElement(empty)) throw corruptPart(entry, 'Cell clone is not an element');
  empty.removeAttribute(CELL_TYPE_ATTRIBUTE);
  row.replaceChild(empty, cell);
}

function assertCellWithinCaps(entry: string, position: CellPosition, caps: ReadCopyCaps): void {
  if (position.row > caps.rowCap + 1) {
    throw new SpreadsheetFileError(
      'ROW_CAP_EXCEEDED',
      `Sheet '${entry}' has a cell in row ${position.row}, beyond the row cap`,
      { entry, row: position.row, rowCap: caps.rowCap },
    );
  }
  if (position.col > caps.colCap) {
    throw new SpreadsheetFileError(
      'COL_CAP_EXCEEDED',
      `Sheet '${entry}' has a cell in column ${position.col}, beyond cap ${caps.colCap}`,
      { entry, col: position.col, colCap: caps.colCap },
    );
  }
}

/** Checks and caps every cell under `sheetData` as it is walked and empties uncached formula cells. */
function processCells(entry: string, sheetData: Element, caps: ReadCopyCaps): void {
  const rowChildNodeLimit = ROW_CHILD_NODES_PER_COLUMN * caps.colCap + ROW_CHILD_NODES_SLACK;
  let maxRow = 0;
  let maxCol = 0;
  for (const row of childElements(sheetData)) {
    if (localName(row.tagName) !== ROW) continue;
    if (row.childNodes.length > rowChildNodeLimit) {
      throw corruptPart(entry, `Row has more than ${rowChildNodeLimit} child nodes`);
    }
    let rowNumber: number | null = null;
    let lastCol = 0;
    for (const cell of childElements(row)) {
      if (localName(cell.tagName) !== CELL) continue;
      const position = cellPosition(entry, cell);
      if (rowNumber !== null && position.row !== rowNumber) {
        throw corruptPart(entry, 'Row holds cells of different rows');
      }
      if (position.col <= lastCol) {
        throw corruptPart(entry, 'Row cells are not in strictly increasing column order');
      }
      rowNumber = position.row;
      lastCol = position.col;
      assertCellWithinCaps(entry, position, caps);
      maxRow = Math.max(maxRow, position.row);
      maxCol = Math.max(maxCol, position.col);
      if (maxRow * maxCol > MAX_TOTAL_CELLS) {
        throw new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          `Sheet '${entry}' grid (${maxRow} x ${maxCol}) exceeds cap ${MAX_TOTAL_CELLS} cells`,
          { entry, cells: maxRow * maxCol, cap: MAX_TOTAL_CELLS },
        );
      }
      emptyUncachedFormulaCell(entry, row, cell);
    }
  }
}

/** Rewrites every format code the reader reads to its canonical equivalent. */
function canonicalizeNumberFormats(entry: string, rootChildren: readonly Element[]): void {
  for (const numFmts of rootChildren) {
    if (localName(numFmts.tagName) !== NUMBER_FORMATS) continue;
    for (const numFmt of childElements(numFmts)) {
      if (localName(numFmt.tagName) !== NUMBER_FORMAT) continue;
      const code = numFmt.getAttribute(FORMAT_CODE_ATTRIBUTE);
      if (code === null) continue;
      if (code.length > MAX_FORMAT_CODE_LENGTH) {
        throw new SpreadsheetFileError(
          'UNSAFE_CONTENT',
          `Workbook part '${entry}' has a number format longer than ${MAX_FORMAT_CODE_LENGTH} characters`,
          { entry, cap: MAX_FORMAT_CODE_LENGTH },
        );
      }
      numFmt.setAttribute(FORMAT_CODE_ATTRIBUTE, canonicalFormatCode(code));
    }
  }
}

function characterReference(character: string): string {
  return `&#${character.charCodeAt(0)};`;
}

function serializePart(entry: string, doc: Document): string {
  let text: string;
  try {
    text = new XMLSerializer().serializeToString(doc);
  } catch (e) {
    throw corruptPart(entry, 'Workbook part cannot be serialized', e);
  }
  return text.replace(READER_NORMALIZED_CHARACTERS, characterReference);
}

function rewritePart(entry: string, xml: string, caps: ReadCopyCaps): string {
  const doc = parsePart(entry, xml);
  const root = doc.documentElement;
  if (root === null) throw corruptPart(entry, 'Workbook part has no root element');

  const rootChildren = childElements(root);
  const sheetData = rootChildren.find((child) => localName(child.tagName) === SHEET_DATA);
  if (sheetData !== undefined) {
    removeDimension(entry, root, rootChildren);
    processCells(entry, sheetData, caps);
  }
  canonicalizeNumberFormats(entry, rootChildren);
  return serializePart(entry, doc);
}

/** The zip entry name read-excel-file's getFilePath maps a relationship Target to. */
function readerFilePath(target: string): string {
  return target.startsWith(ABSOLUTE_TARGET_PREFIX)
    ? target.slice(ABSOLUTE_TARGET_PREFIX.length)
    : `${RELATIVE_TARGET_BASE}${target}`;
}

/**
 * Entry names the workbook rels map the relationships of the given `types` to, in
 * document order (repeats included), resolved exactly as read-excel-file does:
 * direct `Relationship` children of the root (by local name) whose `Type` is one
 * of `types`, their `Target` mapped by getFilePath. The rels part is parsed
 * strictly. CORRUPT_FILE when it does not parse, has no root, or a matching
 * relationship has no `Target` (the reader would throw on it).
 */
function relationshipPartPaths(relsXml: string, types: ReadonlySet<string>): string[] {
  const root = parsePart(WORKBOOK_RELS_PART, relsXml).documentElement;
  if (root === null) throw corruptPart(WORKBOOK_RELS_PART, 'Workbook part has no root element');
  const paths: string[] = [];
  for (const relationship of childElements(root)) {
    if (localName(relationship.tagName) !== RELATIONSHIP) continue;
    const type = relationship.getAttribute(RELATIONSHIP_TYPE_ATTRIBUTE);
    if (type === null || !types.has(type)) continue;
    const target = relationship.getAttribute(RELATIONSHIP_TARGET_ATTRIBUTE);
    if (target === null) {
      throw corruptPart(WORKBOOK_RELS_PART, 'Workbook relationship has no Target');
    }
    paths.push(readerFilePath(target));
  }
  return paths;
}

/**
 * Entry names of the styles, shared strings and worksheet parts the workbook rels
 * name, in document order (repeats included); see relationshipPartPaths.
 */
export function readerPartPaths(relsXml: string): string[] {
  return relationshipPartPaths(relsXml, READER_RELATIONSHIP_TYPES);
}

/**
 * Entry names of the worksheet parts the workbook rels of `entries` name, each
 * once, in document order, resolved the way the reader resolves them (see
 * relationshipPartPaths). These are exactly the worksheets the upload gate parsed
 * and bounded; any other entry under `xl/worksheets/` was never checked. Throws
 * SpreadsheetFileError CORRUPT_FILE when the workbook rels part is missing or does
 * not parse; an archive that passed the gate always has well-formed rels.
 */
export function resolveWorksheetPartPaths(entries: Unzipped): readonly string[] {
  const rels = entries[WORKBOOK_RELS_PART];
  if (rels === undefined) throw corruptPart(WORKBOOK_RELS_PART, 'Workbook rels part is missing');
  return [...new Set(relationshipPartPaths(strFromU8(rels), WORKSHEET_RELATIONSHIP_TYPES))];
}

/**
 * Returns the read copy of the given parts (the gate passes only the parts the
 * reader opens): every `.xml` / `.xml.rels` part is rewritten from its DOM (see the
 * header), any other entry is left out.
 * Throws SpreadsheetFileError: CORRUPT_FILE for a part that does not parse, a
 * malformed cell reference or a malformed row; ROW_CAP_EXCEEDED / COL_CAP_EXCEEDED
 * for a cell beyond the caps; PAYLOAD_TOO_LARGE for a grid beyond MAX_TOTAL_CELLS
 * or serialized parts beyond MAX_XML_TOTAL_BYTES; UNSAFE_CONTENT for an over-long
 * number format.
 */
export function buildReadCopy(entries: Unzipped, caps: ReadCopyCaps): Unzipped {
  const maxBytes = Math.min(caps.maxXmlBytes ?? MAX_XML_TOTAL_BYTES, MAX_XML_TOTAL_BYTES);
  const copy: Unzipped = {};
  let totalBytes = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!isXmlPart(name)) continue;
    const serialized = strToU8(rewritePart(name, strFromU8(bytes), caps));
    totalBytes += serialized.length;
    if (totalBytes > maxBytes) {
      throw new SpreadsheetFileError(
        'PAYLOAD_TOO_LARGE',
        `Serialized workbook XML parts exceed ${maxBytes}B`,
        { cap: maxBytes },
      );
    }
    copy[name] = serialized;
  }
  return copy;
}
