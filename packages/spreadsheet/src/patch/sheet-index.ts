import { isUtf8 } from 'node:buffer';

import { ABSOLUTE_MAX_COLS, SPREADSHEET_MAIN_NAMESPACES } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { cellKey, colRefToNumber } from '../sheet-meta';
import { MALFORMED_SHEET_REASONS, UNSUPPORTED_ENCODING_REASONS } from './reasons';
import {
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  attributeField,
  bytesEqualAscii,
  createMarkup,
  isXmlSpace,
  localNameIs,
  localNameStart,
  nextMarkup,
  scanDeclaration,
  scanMarkup,
  valueAt,
  XmlLexError,
  type XmlMarkup,
} from './xml-lexer';

// Defined once, in the lexer; kept reachable from here for callers that walk a SheetIndex.
export { valueAt } from './xml-lexer';

// The rows and cells of one worksheet part, found the way the reader finds them
// (part-checks.ts): the first direct child of the root whose local name is
// `sheetData`, its direct children named `row`, their direct children named `c`. The
// patcher writes into the byte ranges recorded here, so the index must see exactly
// the cells the reader placed:
//   - every markup of the part goes through the strict lexer, so a tag xmldom reads
//     leniently is refused instead of read another way;
//   - `r` is read as raw bytes and must have the reader's reference shape; rows and
//     cells go strictly up, and a cell's row digits equal its row's `r`;
//   - the sheet data, every row and every cell must resolve to a SpreadsheetML main
//     namespace (the reader ignores namespaces; the marketplace does not);
//   - the part is valid UTF-8 and declares no other encoding.
//
// One forward pass with a depth counter: no recursion and no stack of names. Content
// the reader never looks at (other children, a cell's subtree) is scanned (which
// validates it) and skipped by depth alone. A namespace scope exists only for the
// root, the sheet data, a row and a cell, each a Map of the element's own
// declarations linked to its parent's scope, created only when it declares any.

/** Rows and cells of one worksheet part as byte offsets into `bytes`; parallel arrays, no object per cell. */
export interface SheetIndex {
  readonly bytes: Uint8Array;
  /** Strictly ascending. */
  readonly rowNumber: readonly number[];
  /** The '<' of the row's start tag. */
  readonly rowStart: readonly number[];
  /** Just past the start tag's '>'. */
  readonly rowTagEnd: readonly number[];
  /** Just past the end tag; equals rowTagEnd for a self-closing row. */
  readonly rowEnd: readonly number[];
  /** Rows + 1 entries: the cells of row i are [rowFirstCell[i], rowFirstCell[i + 1]). */
  readonly rowFirstCell: readonly number[];
  /** 1-based, strictly ascending inside a row. */
  readonly cellColumn: readonly number[];
  readonly cellStart: readonly number[];
  readonly cellTagEnd: readonly number[];
  /** Equals cellTagEnd for a self-closing cell. */
  readonly cellEnd: readonly number[];
}

type MalformedSheetReason = (typeof MALFORMED_SHEET_REASONS)[keyof typeof MALFORMED_SHEET_REASONS];
type UnsupportedEncodingReason =
  (typeof UNSUPPORTED_ENCODING_REASONS)[keyof typeof UNSUPPORTED_ENCODING_REASONS];

/** One element's own namespace declarations, linked to the scope it inherits. */
interface NamespaceScope {
  /** Declared prefix ('' for the default namespace) -> whether its raw value is a main namespace. */
  readonly bindings: ReadonlyMap<string, boolean>;
  readonly parent: NamespaceScope | null;
}

const SHEET_DATA = 'sheetData';
const ROW = 'row';
const CELL = 'c';
const REFERENCE_ATTRIBUTE = 'r';
// How the name of a prefixed `r` attribute ends; refused, as a repeated `r` is.
const PREFIXED_REFERENCE_SUFFIX = ':r';
const DEFAULT_NAMESPACE_DECLARATION = 'xmlns';
const PREFIX_DECLARATION_START = 'xmlns:';
const DEFAULT_NAMESPACE_PREFIX = '';
// Reserved by XML; neither is ever bound to a namespace the filter accepts.
const RESERVED_PREFIXES: ReadonlySet<string> = new Set(['xml', 'xmlns']);
const XML_DECLARATION_TARGET = 'xml';
const ENCODING_PSEUDO_ATTRIBUTE = 'encoding';
// The only encoding a declaration may name, compared ignoring ASCII case.
const UTF8_ENCODING_NAME = 'utf-8';
const UTF8_BYTE_ORDER_MARK: readonly number[] = [0xef, 0xbb, 0xbf];

// '?': opens a processing instruction after '<'.
const QUESTION = 0x3f;
const DIGIT_ZERO = 0x30;
const DIGIT_ONE = 0x31;
const DIGIT_NINE = 0x39;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const ASCII_CASE_OFFSET = 0x20;
const DECIMAL_BASE = 10;
// A row reference is [1-9][0-9]{0,6}; a cell reference puts 1 to 3 letters before it.
const MAX_ROW_REFERENCE_DIGITS = 7;
const MAX_COLUMN_LETTERS = 3;

// Depth (open elements) at which each tracked element's tag is met; the element is
// closed by the end tag that brings the depth back to the same value.
const ROOT_DEPTH = 0;
const SHEET_DATA_DEPTH = 1;
const ROW_DEPTH = 2;
const CELL_DEPTH = 3;

// Names are ASCII (the lexer refuses any other byte in a name), so UTF-8 decodes them as is.
const NAME_DECODER = new TextDecoder();

function malformedSheet(
  reason: MalformedSheetReason,
  offset: number,
  detail: string,
): SpreadsheetFileError {
  return new SpreadsheetFileError('MALFORMED_SHEET', `Worksheet part ${detail}`, {
    reason,
    offset,
  });
}

function unsupportedEncoding(
  reason: UnsupportedEncodingReason,
  detail: string,
): SpreadsheetFileError {
  return new SpreadsheetFileError('UNSUPPORTED_ENCODING', `Worksheet part ${detail}`, { reason });
}

function malformedStructure(offset: number, detail: string): SpreadsheetFileError {
  return malformedSheet(MALFORMED_SHEET_REASONS.STRUCTURE, offset, detail);
}

function setLast(list: number[], value: number): void {
  list[list.length - 1] = value;
}

function isUpperLetter(byte: number | undefined): boolean {
  return byte !== undefined && byte >= UPPER_A && byte <= UPPER_Z;
}

function lowerAscii(byte: number): number {
  return byte >= UPPER_A && byte <= UPPER_Z ? byte + ASCII_CASE_OFFSET : byte;
}

/** Whether bytes [start, end) are `lowerText` (lower-case ASCII), ignoring ASCII case. */
function bytesEqualAsciiIgnoreCase(
  bytes: Uint8Array,
  start: number,
  end: number,
  lowerText: string,
): boolean {
  if (end - start !== lowerText.length) return false;
  for (let index = 0; index < lowerText.length; index += 1) {
    const byte = bytes[start + index];
    if (byte === undefined || lowerAscii(byte) !== lowerText.charCodeAt(index)) return false;
  }
  return true;
}

/** Whether bytes [start, end) equal bytes [otherStart, otherEnd) of the same part. */
function bytesEqualRange(
  bytes: Uint8Array,
  start: number,
  end: number,
  otherStart: number,
  otherEnd: number,
): boolean {
  if (end - start !== otherEnd - otherStart) return false;
  for (let index = 0; index < end - start; index += 1) {
    if (bytes[start + index] !== bytes[otherStart + index]) return false;
  }
  return true;
}

function startsWithByteOrderMark(bytes: Uint8Array): boolean {
  return UTF8_BYTE_ORDER_MARK.every((byte, index) => bytes[index] === byte);
}

/** The row number of raw reference bytes [1-9][0-9]{0,6}, or null for any other bytes. */
function parseRowReference(bytes: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  if (length < 1 || length > MAX_ROW_REFERENCE_DIGITS) return null;
  let rowNumber = 0;
  for (let at = start; at < end; at += 1) {
    const byte = bytes[at];
    const lowest = at === start ? DIGIT_ONE : DIGIT_ZERO;
    if (byte === undefined || byte < lowest || byte > DIGIT_NINE) return null;
    rowNumber = rowNumber * DECIMAL_BASE + (byte - DIGIT_ZERO);
  }
  return rowNumber;
}

/** Raw bytes, so a value holding a character reference never matches. */
function isMainNamespace(bytes: Uint8Array, start: number, end: number): boolean {
  return SPREADSHEET_MAIN_NAMESPACES.some((namespace) =>
    bytesEqualAscii(bytes, start, end, namespace),
  );
}

/** At most one Map read per scope: cell, row, sheet data, root. */
function resolvesToMainNamespace(scope: NamespaceScope | null, prefix: string): boolean {
  if (RESERVED_PREFIXES.has(prefix)) return false;
  for (let current = scope; current !== null; current = current.parent) {
    const isMain = current.bindings.get(prefix);
    if (isMain !== undefined) return isMain;
  }
  return false;
}

class WorksheetIndexer {
  private readonly bytes: Uint8Array;
  private readonly markup: XmlMarkup = createMarkup();
  private readonly attributes: number[] = [];

  private depth = ROOT_DEPTH;
  private rootSeen = false;
  private sheetDataSeen = false;
  private sheetDataOpen = false;
  private rowOpen = false;
  private cellOpen = false;
  private rootScope: NamespaceScope | null = null;
  private sheetDataScope: NamespaceScope | null = null;
  private rowScope: NamespaceScope | null = null;
  private lastRowNumber = 0;
  private lastColumn = 0;
  private rowReferenceStart = 0;
  private rowReferenceEnd = 0;

  private readonly rowNumber: number[] = [];
  private readonly rowStart: number[] = [];
  private readonly rowTagEnd: number[] = [];
  private readonly rowEnd: number[] = [];
  private readonly rowFirstCell: number[] = [];
  private readonly cellColumn: number[] = [];
  private readonly cellStart: number[] = [];
  private readonly cellTagEnd: number[] = [];
  private readonly cellEnd: number[] = [];

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  index(): SheetIndex {
    const bytes = this.bytes;
    let position = startsWithByteOrderMark(bytes) ? UTF8_BYTE_ORDER_MARK.length : 0;
    let first = true;
    for (;;) {
      const at = nextMarkup(bytes, position);
      if (this.depth === ROOT_DEPTH) this.assertSpaceOnly(position, at === -1 ? bytes.length : at);
      if (at === -1) break;
      scanMarkup(bytes, at, this.markup, this.attributes);
      if (first && this.isXmlDeclaration()) this.checkDeclaration();
      else this.visit();
      first = false;
      position = this.markup.end;
    }
    if (!this.rootSeen) throw malformedStructure(bytes.length, 'has no root element');
    if (this.depth !== ROOT_DEPTH) {
      throw malformedStructure(bytes.length, 'ends inside the root element');
    }
    this.rowFirstCell.push(this.cellColumn.length);
    return {
      bytes,
      rowNumber: this.rowNumber,
      rowStart: this.rowStart,
      rowTagEnd: this.rowTagEnd,
      rowEnd: this.rowEnd,
      rowFirstCell: this.rowFirstCell,
      cellColumn: this.cellColumn,
      cellStart: this.cellStart,
      cellTagEnd: this.cellTagEnd,
      cellEnd: this.cellEnd,
    };
  }

  private visit(): void {
    const kind = this.markup.kind;
    switch (kind) {
      case 'start':
      case 'empty':
        this.visitElement();
        return;
      case 'end':
        this.visitEndTag();
        return;
      case 'opaque':
        this.visitOpaque();
        return;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
      }
    }
  }

  /** A start or empty tag met at the current depth. */
  private visitElement(): void {
    const { bytes, markup } = this;
    const met = this.depth;
    if (met === ROOT_DEPTH) {
      this.openRoot();
    } else if (met === SHEET_DATA_DEPTH && localNameIs(bytes, markup, SHEET_DATA)) {
      this.openSheetData();
    } else if (met === ROW_DEPTH && this.sheetDataOpen && localNameIs(bytes, markup, ROW)) {
      this.openRow();
    } else if (met === CELL_DEPTH && this.rowOpen && localNameIs(bytes, markup, CELL)) {
      this.openCell();
    }
    if (markup.kind === 'start') this.depth += 1;
  }

  private visitEndTag(): void {
    if (this.depth === ROOT_DEPTH) {
      throw malformedStructure(this.markup.start, 'has an end tag outside the root element');
    }
    this.depth -= 1;
    const end = this.markup.end;
    if (this.depth === ROOT_DEPTH) {
      if (!this.sheetDataSeen) {
        throw malformedStructure(this.markup.start, 'has no sheetData element');
      }
    } else if (this.depth === SHEET_DATA_DEPTH && this.sheetDataOpen) {
      this.sheetDataOpen = false;
    } else if (this.depth === ROW_DEPTH && this.rowOpen) {
      setLast(this.rowEnd, end);
      this.rowOpen = false;
    } else if (this.depth === CELL_DEPTH && this.cellOpen) {
      setLast(this.cellEnd, end);
      this.cellOpen = false;
    }
  }

  /** A comment, CDATA section or processing instruction: never looked into. */
  private visitOpaque(): void {
    if (!this.isProcessingInstruction()) return;
    const { nameStart, nameEnd } = this.markup;
    if (!bytesEqualAsciiIgnoreCase(this.bytes, nameStart, nameEnd, XML_DECLARATION_TARGET)) return;
    throw malformedStructure(this.markup.start, 'has an XML declaration after its first markup');
  }

  private isProcessingInstruction(): boolean {
    return this.markup.kind === 'opaque' && this.bytes[this.markup.start + 1] === QUESTION;
  }

  private isXmlDeclaration(): boolean {
    const { nameStart, nameEnd } = this.markup;
    return (
      this.isProcessingInstruction() &&
      bytesEqualAscii(this.bytes, nameStart, nameEnd, XML_DECLARATION_TARGET)
    );
  }

  // Attribute access. The count of the attributes the last scan filled comes from this
  // method, each of their offsets from the lexer's attributeField over this.attributes.

  /** Number of attributes of the markup the last scan read. */
  private attributeCount(): number {
    return this.markup.attributeCount;
  }

  /** An `encoding` pseudo-attribute must name UTF-8, ignoring ASCII case. */
  private checkDeclaration(): void {
    scanDeclaration(this.bytes, this.markup, this.attributes);
    for (let attribute = 0; attribute < this.attributeCount(); attribute += 1) {
      if (!this.attributeNameIs(attribute, ENCODING_PSEUDO_ATTRIBUTE)) continue;
      const valueStart = attributeField(this.attributes, attribute, ATTRIBUTE_VALUE_START);
      const valueEnd = attributeField(this.attributes, attribute, ATTRIBUTE_VALUE_END);
      if (bytesEqualAsciiIgnoreCase(this.bytes, valueStart, valueEnd, UTF8_ENCODING_NAME)) continue;
      throw unsupportedEncoding(
        UNSUPPORTED_ENCODING_REASONS.DECLARATION,
        'declares an encoding other than UTF-8',
      );
    }
  }

  private openRoot(): void {
    if (this.rootSeen) {
      throw malformedStructure(this.markup.start, 'has an element after the root element');
    }
    if (this.markup.kind !== 'start') {
      throw malformedStructure(this.markup.start, 'has a self-closing root element');
    }
    this.rootScope = this.scopeOf(null);
    this.rootSeen = true;
  }

  private openSheetData(): void {
    if (this.sheetDataSeen) {
      throw malformedStructure(this.markup.start, 'has more than one sheetData element');
    }
    const scope = this.scopeOf(this.rootScope);
    this.assertMainNamespace(scope);
    this.sheetDataSeen = true;
    if (this.markup.kind !== 'start') return;
    this.sheetDataOpen = true;
    this.sheetDataScope = scope;
  }

  private openRow(): void {
    const { start, end, kind } = this.markup;
    const scope = this.scopeOf(this.sheetDataScope);
    this.assertMainNamespace(scope);
    const reference = this.referenceAttribute(MALFORMED_SHEET_REASONS.ROW_REF);
    const valueStart = attributeField(this.attributes, reference, ATTRIBUTE_VALUE_START);
    const valueEnd = attributeField(this.attributes, reference, ATTRIBUTE_VALUE_END);
    const rowNumber = parseRowReference(this.bytes, valueStart, valueEnd);
    if (rowNumber === null) {
      throw malformedSheet(MALFORMED_SHEET_REASONS.ROW_REF, start, 'has a malformed row reference');
    }
    if (rowNumber <= this.lastRowNumber) {
      throw malformedSheet(
        MALFORMED_SHEET_REASONS.ROW_REF,
        start,
        'has rows out of strictly ascending order',
      );
    }
    this.lastRowNumber = rowNumber;
    this.rowNumber.push(rowNumber);
    this.rowStart.push(start);
    this.rowTagEnd.push(end);
    this.rowEnd.push(end);
    this.rowFirstCell.push(this.cellColumn.length);
    if (kind !== 'start') return;
    this.rowOpen = true;
    this.rowScope = scope;
    this.lastColumn = 0;
    this.rowReferenceStart = valueStart;
    this.rowReferenceEnd = valueEnd;
  }

  private openCell(): void {
    const { start, end, kind } = this.markup;
    const scope = this.scopeOf(this.rowScope);
    this.assertMainNamespace(scope);
    const reference = this.referenceAttribute(MALFORMED_SHEET_REASONS.CELL_REF);
    const column = this.cellReferenceColumn(
      attributeField(this.attributes, reference, ATTRIBUTE_VALUE_START),
      attributeField(this.attributes, reference, ATTRIBUTE_VALUE_END),
    );
    if (column <= this.lastColumn) {
      throw malformedSheet(
        MALFORMED_SHEET_REASONS.CELL_REF,
        start,
        'has cells out of strictly ascending column order',
      );
    }
    this.lastColumn = column;
    this.cellColumn.push(column);
    this.cellStart.push(start);
    this.cellTagEnd.push(end);
    this.cellEnd.push(end);
    if (kind === 'start') this.cellOpen = true;
  }

  /**
   * The column of the cell reference in bytes [start, end): 1 to 3 letters A-Z, then
   * exactly the bytes of the row's own `r`, at most ABSOLUTE_MAX_COLS.
   */
  private cellReferenceColumn(start: number, end: number): number {
    let digits = start;
    while (digits < end && isUpperLetter(this.bytes[digits])) digits += 1;
    const letters = digits - start;
    const rowMatches = bytesEqualRange(
      this.bytes,
      digits,
      end,
      this.rowReferenceStart,
      this.rowReferenceEnd,
    );
    if (letters < 1 || letters > MAX_COLUMN_LETTERS || !rowMatches) {
      throw malformedSheet(
        MALFORMED_SHEET_REASONS.CELL_REF,
        this.markup.start,
        'has a malformed cell reference or one outside its row',
      );
    }
    const column = colRefToNumber(String.fromCharCode(...this.bytes.subarray(start, digits)));
    if (column > ABSOLUTE_MAX_COLS) {
      throw malformedSheet(
        MALFORMED_SHEET_REASONS.CELL_REF,
        this.markup.start,
        `has a cell beyond column ${ABSOLUTE_MAX_COLS}`,
      );
    }
    return column;
  }

  /** The tag's only `r` attribute (its index); `reason` when it has none, two, or a prefixed one. */
  private referenceAttribute(reason: MalformedSheetReason): number {
    let found = -1;
    for (let attribute = 0; attribute < this.attributeCount(); attribute += 1) {
      if (this.attributeNameIs(attribute, REFERENCE_ATTRIBUTE)) {
        if (found !== -1) {
          throw malformedSheet(reason, this.markup.start, 'has a repeated reference attribute');
        }
        found = attribute;
      } else if (this.isPrefixedReference(attribute)) {
        throw malformedSheet(reason, this.markup.start, 'has a prefixed reference attribute');
      }
    }
    if (found === -1) throw malformedSheet(reason, this.markup.start, 'has no reference attribute');
    return found;
  }

  private isPrefixedReference(attribute: number): boolean {
    const nameStart = attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(this.attributes, attribute, ATTRIBUTE_NAME_END);
    const suffixStart = nameEnd - PREFIXED_REFERENCE_SUFFIX.length;
    return (
      suffixStart > nameStart &&
      bytesEqualAscii(this.bytes, suffixStart, nameEnd, PREFIXED_REFERENCE_SUFFIX) &&
      this.declaredPrefix(nameStart, nameEnd) === null
    );
  }

  private attributeNameIs(attribute: number, name: string): boolean {
    return bytesEqualAscii(
      this.bytes,
      attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START),
      attributeField(this.attributes, attribute, ATTRIBUTE_NAME_END),
      name,
    );
  }

  /** The prefix an `xmlns` / `xmlns:p` attribute name declares ('' for the default), else null. */
  private declaredPrefix(nameStart: number, nameEnd: number): string | null {
    if (bytesEqualAscii(this.bytes, nameStart, nameEnd, DEFAULT_NAMESPACE_DECLARATION)) {
      return DEFAULT_NAMESPACE_PREFIX;
    }
    const prefixStart = nameStart + PREFIX_DECLARATION_START.length;
    if (prefixStart >= nameEnd) return null;
    if (!bytesEqualAscii(this.bytes, nameStart, prefixStart, PREFIX_DECLARATION_START)) return null;
    return NAME_DECODER.decode(this.bytes.subarray(prefixStart, nameEnd));
  }

  /**
   * The scope of the current tag: a Map of its own namespace declarations linked to
   * `parent`, or `parent` itself when it declares none. Nothing is copied. An
   * `xmlns=""` is stored like any other declaration, so it shadows the parent's default.
   */
  private scopeOf(parent: NamespaceScope | null): NamespaceScope | null {
    let bindings: Map<string, boolean> | null = null;
    for (let attribute = 0; attribute < this.attributeCount(); attribute += 1) {
      const prefix = this.declaredPrefix(
        attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START),
        attributeField(this.attributes, attribute, ATTRIBUTE_NAME_END),
      );
      if (prefix === null) continue;
      bindings ??= new Map();
      if (bindings.has(prefix)) {
        throw malformedSheet(
          MALFORMED_SHEET_REASONS.NAMESPACE,
          this.markup.start,
          'declares one namespace prefix twice on an element',
        );
      }
      const valueStart = attributeField(this.attributes, attribute, ATTRIBUTE_VALUE_START);
      const valueEnd = attributeField(this.attributes, attribute, ATTRIBUTE_VALUE_END);
      bindings.set(prefix, isMainNamespace(this.bytes, valueStart, valueEnd));
    }
    return bindings === null ? parent : { bindings, parent };
  }

  /** The current tag's prefix (or the default namespace) must resolve to a main namespace. */
  private assertMainNamespace(scope: NamespaceScope | null): void {
    const { nameStart, start } = this.markup;
    const localStart = localNameStart(this.bytes, this.markup);
    const prefix =
      localStart === nameStart
        ? DEFAULT_NAMESPACE_PREFIX
        : NAME_DECODER.decode(this.bytes.subarray(nameStart, localStart - 1));
    if (resolvesToMainNamespace(scope, prefix)) return;
    throw malformedSheet(
      MALFORMED_SHEET_REASONS.NAMESPACE,
      start,
      'has a sheet element outside the SpreadsheetML main namespace',
    );
  }

  /** Outside the root only S bytes may stand between markups. */
  private assertSpaceOnly(from: number, to: number): void {
    for (let at = from; at < to; at += 1) {
      if (!isXmlSpace(this.bytes[at])) {
        throw malformedStructure(at, 'has content outside the root element');
      }
    }
  }
}

/**
 * Rows and cells of one worksheet part, in one pass.
 *
 * Precondition: the part has already passed the reader's strict parse (`parsePart`).
 * The index counts depth and never compares an end tag's name with its start tag's,
 * nor checks the declaration's position, the root's prefix binding or repeated
 * attributes other than `r`; xmldom refuses all of those, and the patch pipeline
 * always runs the reader on the same bytes first. Without that parse a crossed end
 * tag such as `<c r="A1"><v>1</c></v>` gives a wrong cell range.
 *
 * Throws SpreadsheetFileError:
 * UNSUPPORTED_ENCODING `{ reason }` for bytes that are not UTF-8 or a declaration of
 * another encoding; MALFORMED_SHEET `{ reason, offset }` otherwise (`markup` for a
 * tag outside the lexer's strict subset).
 */
export function indexWorksheet(bytes: Uint8Array): SheetIndex {
  if (!isUtf8(bytes)) {
    throw unsupportedEncoding(UNSUPPORTED_ENCODING_REASONS.BYTES, 'is not valid UTF-8');
  }
  try {
    return new WorksheetIndexer(bytes).index();
  } catch (error) {
    if (!(error instanceof XmlLexError)) throw error;
    throw malformedSheet(
      MALFORMED_SHEET_REASONS.MARKUP,
      error.offset,
      `has markup outside the strict subset: ${error.message}`,
    );
  }
}

/** `cellKey(row, column)` of every cell, in document order. */
export function cellKeysOf(index: SheetIndex): number[] {
  const keys: number[] = [];
  for (let row = 0; row < index.rowNumber.length; row += 1) {
    const rowNumber = valueAt(index.rowNumber, row);
    const firstCellOfNextRow = valueAt(index.rowFirstCell, row + 1);
    for (let cell = valueAt(index.rowFirstCell, row); cell < firstCellOfNextRow; cell += 1) {
      keys.push(cellKey(rowNumber, valueAt(index.cellColumn, cell)));
    }
  }
  return keys;
}
