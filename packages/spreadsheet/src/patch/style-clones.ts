import { isUtf8 } from 'node:buffer';

import { strFromU8 } from 'fflate';

import { extractXfIsDate } from '../book';
import { ReaderRuleError } from '../cell-value';
import { SpreadsheetFileError } from '../errors';
import { parsePart } from '../xml-dom';
import { patchedPartCap } from './patch-worksheet';
import {
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  attributeField,
  bytesEqualAscii,
  createMarkup,
  declaresUtf8,
  hasDeclarationTarget,
  isXmlDeclaration,
  localNameIs,
  localNameStart,
  nextMarkup,
  scanMarkup,
  valueAt,
  XmlLexError,
  type XmlMarkup,
} from './xml-lexer';

// General clones of date styles, for the export patch path. A number written into a
// cell whose style formats a date would read back as a date (Excel shows it as one,
// and so does our reader), so the patcher points such a cell at a clone of its style
// whose number format is General: the cell keeps its font, fill, border and alignment.
//
// A clone is the source `xf` element byte for byte, except that its `numFmtId` value
// becomes 0 and its `applyNumberFormat` value 1 (inserted right after `numFmtId` when
// absent). The clones of one output go right before the `</cellXfs>` end tag, in the
// order its cells first asked for them, and a `count` on the cellXfs start tag becomes
// the new number of entries. Each output is its own archive, so each numbers its clones
// from the end of the source table and carries a styles part with exactly its own.
//
// The styles part is walked with the strict lexer, every markup of it, with a depth
// counter, and must yield the entries the reader's date table came from
// (extractXfIsDate): the first direct child of the root whose local name is `cellXfs`,
// and its direct `xf` children. Anything this walk cannot read that way answers null,
// and the caller keeps today's output (the date style dropped): bytes that are not
// UTF-8, a declaration that is not first or names another encoding, a lexer error, no
// root, a missing, self-closing or second `cellXfs`, a child of it that is not an `xf`
// under the cellXfs tag's own prefix, or an entry count other than the table's. A source
// `xf` without exactly one `numFmtId`, or with two `applyNumberFormat`, gets no clone.
// The built part must fit the patch growth cap, and the reader's own rule must read it
// as the old table followed by one non-date entry per clone (a custom `numFmt` may
// redefine id 0 as a date); otherwise null too. Nothing here throws for a styles part it
// cannot handle.

const CELL_FORMATS = 'cellXfs';
const CELL_FORMAT = 'xf';
const COUNT_ATTRIBUTE = 'count';
const NUMBER_FORMAT_ID_ATTRIBUTE = 'numFmtId';
const APPLY_NUMBER_FORMAT_ATTRIBUTE = 'applyNumberFormat';
// Built-in number format 0: General.
const GENERAL_FORMAT_ID = '0';
const APPLY_ON = '1';
const INSERTED_APPLY_NUMBER_FORMAT = ` ${APPLY_NUMBER_FORMAT_ATTRIBUTE}="${APPLY_ON}"`;
const ROOT_DEPTH = 0;
const CHILD_DEPTH = 1;
const GRANDCHILD_DEPTH = 2;
const NO_ATTRIBUTE = -1;
const NO_OFFSET = -1;
// An attribute's value is followed by its closing quote.
const CLOSING_QUOTE_LENGTH = 1;
// Joins the source indexes of an output into the key of its built part.
const SOURCE_KEY_SEPARATOR = ',';

const encoder = new TextEncoder();

/** Where the walk found the cellXfs entries, as offsets into the styles part. */
interface StylesLayout {
  /** The value of the cellXfs start tag's `count`, without its quotes; NO_OFFSET when it has none. */
  readonly countStart: number;
  readonly countEnd: number;
  /** The '<' of the cellXfs end tag. */
  readonly cellXfsEnd: number;
  /** Bytes [start, end) of each direct `xf` child, in document order. */
  readonly xfStarts: readonly number[];
  readonly xfEnds: readonly number[];
}

/** Replace part bytes [start, end) with `content`. */
interface ByteEdit {
  readonly start: number;
  readonly end: number;
  readonly content: Uint8Array;
}

/** `read()`, or null when it throws an error a styles part it cannot handle raises. */
function guarded<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch (error) {
    if (
      error instanceof XmlLexError ||
      error instanceof SpreadsheetFileError ||
      error instanceof ReaderRuleError
    ) {
      return null;
    }
    throw error;
  }
}

/** Whether attribute `attribute` of the last scanned tag is named exactly `name`. */
function isAttributeNamed(
  bytes: Uint8Array,
  attributes: readonly number[],
  attribute: number,
  name: string,
): boolean {
  return bytesEqualAscii(
    bytes,
    attributeField(attributes, attribute, ATTRIBUTE_NAME_START),
    attributeField(attributes, attribute, ATTRIBUTE_NAME_END),
    name,
  );
}

/**
 * The only attribute of the last scanned tag named exactly `name`: NO_ATTRIBUTE when
 * it has none, null when it has two or more.
 */
function onlyAttribute(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  name: string,
): number | null {
  let found = NO_ATTRIBUTE;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    if (!isAttributeNamed(bytes, attributes, attribute, name)) continue;
    if (found !== NO_ATTRIBUTE) return null;
    found = attribute;
  }
  return found;
}

/** Whether bytes [aStart, aEnd) and [bStart, bEnd) of `bytes` are the same. */
function sameRange(
  bytes: Uint8Array,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  if (aEnd - aStart !== bEnd - bStart) return false;
  for (let offset = 0; offset < aEnd - aStart; offset += 1) {
    if (bytes[aStart + offset] !== bytes[bStart + offset]) return false;
  }
  return true;
}

/**
 * Whether an opaque markup is acceptable: anything but a processing instruction whose
 * target is `xml` in any case, which must be the first markup, exactly `xml`, and name
 * no encoding but UTF-8.
 */
function isAcceptedOpaque(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  first: boolean,
): boolean {
  if (!hasDeclarationTarget(bytes, markup)) return true;
  return first && isXmlDeclaration(bytes, markup) && declaresUtf8(bytes, markup, attributes);
}

/**
 * The cellXfs entries of a styles part (see the top of this file), or null for a part
 * this walk does not read the way the reader does, or whose entry count is not
 * `xfCount`. Throws XmlLexError for markup outside the lexer's subset.
 */
function walkStyles(bytes: Uint8Array, xfCount: number): StylesLayout | null {
  if (!isUtf8(bytes)) return null;
  const markup = createMarkup();
  const attributes: number[] = [];
  const xfStarts: number[] = [];
  const xfEnds: number[] = [];
  let depth = ROOT_DEPTH;
  let rootSeen = false;
  let first = true;
  let cellXfsSeen = false;
  let insideCellXfs = false;
  let xfOpen = false;
  // The prefix of the cellXfs tag's name, colon included: bytes [prefixStart, prefixEnd).
  let prefixStart = NO_OFFSET;
  let prefixEnd = NO_OFFSET;
  let countStart = NO_OFFSET;
  let countEnd = NO_OFFSET;
  let cellXfsEnd = NO_OFFSET;
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
    scanMarkup(bytes, at, markup, attributes);
    const kind = markup.kind;
    switch (kind) {
      case 'start':
      case 'empty':
        if (depth === ROOT_DEPTH) {
          if (rootSeen) return null;
          rootSeen = true;
        } else if (depth === CHILD_DEPTH && localNameIs(bytes, markup, CELL_FORMATS)) {
          if (cellXfsSeen || kind === 'empty') return null;
          const count = onlyAttribute(bytes, markup, attributes, COUNT_ATTRIBUTE);
          if (count === null) return null;
          if (count !== NO_ATTRIBUTE) {
            countStart = attributeField(attributes, count, ATTRIBUTE_VALUE_START);
            countEnd = attributeField(attributes, count, ATTRIBUTE_VALUE_END);
          }
          prefixStart = markup.nameStart;
          prefixEnd = localNameStart(bytes, markup);
          cellXfsSeen = true;
          insideCellXfs = true;
        } else if (depth === GRANDCHILD_DEPTH && insideCellXfs) {
          if (!localNameIs(bytes, markup, CELL_FORMAT)) return null;
          const xfPrefixEnd = localNameStart(bytes, markup);
          if (!sameRange(bytes, prefixStart, prefixEnd, markup.nameStart, xfPrefixEnd)) {
            return null;
          }
          xfStarts.push(markup.start);
          if (kind === 'empty') xfEnds.push(markup.end);
          else xfOpen = true;
        }
        if (kind === 'start') depth += 1;
        break;
      case 'end':
        if (depth === ROOT_DEPTH) return null;
        depth -= 1;
        if (depth === GRANDCHILD_DEPTH && xfOpen) {
          xfEnds.push(markup.end);
          xfOpen = false;
        } else if (depth === CHILD_DEPTH && insideCellXfs) {
          cellXfsEnd = markup.start;
          insideCellXfs = false;
        }
        break;
      case 'opaque':
        if (!isAcceptedOpaque(bytes, markup, attributes, first)) return null;
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
      }
    }
    first = false;
  }
  if (!rootSeen || depth !== ROOT_DEPTH || cellXfsEnd === NO_OFFSET) return null;
  if (xfStarts.length !== xfCount || xfEnds.length !== xfCount) return null;
  return { countStart, countEnd, cellXfsEnd, xfStarts, xfEnds };
}

/** The length of bytes [start, end) with `edits` applied. */
function editedLength(start: number, end: number, edits: readonly ByteEdit[]): number {
  let length = end - start;
  for (const edit of edits) length += edit.content.length - (edit.end - edit.start);
  return length;
}

/** Bytes [start, end) with `edits` (in offset order, none overlapping) applied, in one allocation. */
function edited(
  bytes: Uint8Array,
  start: number,
  end: number,
  edits: readonly ByteEdit[],
): Uint8Array {
  const result = new Uint8Array(editedLength(start, end, edits));
  let cursor = start;
  let written = 0;
  for (const edit of edits) {
    if (edit.start < cursor) throw new Error('Style clone edits overlap');
    result.set(bytes.subarray(cursor, edit.start), written);
    written += edit.start - cursor;
    result.set(edit.content, written);
    written += edit.content.length;
    cursor = edit.end;
  }
  result.set(bytes.subarray(cursor, end), written);
  return result;
}

/**
 * The General clone of the `xf` element at bytes [start, end), or null when its start
 * tag has no attribute named exactly `numFmtId`, two of them, or two named exactly
 * `applyNumberFormat`. Throws XmlLexError for markup outside the lexer's subset.
 */
function generalClone(bytes: Uint8Array, start: number, end: number): Uint8Array | null {
  const markup = createMarkup();
  const attributes: number[] = [];
  scanMarkup(bytes, start, markup, attributes);
  const formatId = onlyAttribute(bytes, markup, attributes, NUMBER_FORMAT_ID_ATTRIBUTE);
  const apply = onlyAttribute(bytes, markup, attributes, APPLY_NUMBER_FORMAT_ATTRIBUTE);
  if (formatId === null || formatId === NO_ATTRIBUTE || apply === null) return null;
  const formatIdStart = attributeField(attributes, formatId, ATTRIBUTE_VALUE_START);
  const formatIdEnd = attributeField(attributes, formatId, ATTRIBUTE_VALUE_END);
  const formatIdEdit: ByteEdit = {
    start: formatIdStart,
    end: formatIdEnd,
    content: encoder.encode(GENERAL_FORMAT_ID),
  };
  if (apply === NO_ATTRIBUTE) {
    const afterQuote = formatIdEnd + CLOSING_QUOTE_LENGTH;
    const inserted: ByteEdit = {
      start: afterQuote,
      end: afterQuote,
      content: encoder.encode(INSERTED_APPLY_NUMBER_FORMAT),
    };
    return edited(bytes, start, end, [formatIdEdit, inserted]);
  }
  const applyEdit: ByteEdit = {
    start: attributeField(attributes, apply, ATTRIBUTE_VALUE_START),
    end: attributeField(attributes, apply, ATTRIBUTE_VALUE_END),
    content: encoder.encode(APPLY_ON),
  };
  const edits =
    applyEdit.start < formatIdEdit.start ? [applyEdit, formatIdEdit] : [formatIdEdit, applyEdit];
  return edited(bytes, start, end, edits);
}

/** Whether the reader's date table of `styles` is exactly `expected`. */
function readsAs(entry: string, styles: Uint8Array, expected: readonly boolean[]): boolean {
  const root = parsePart(entry, strFromU8(styles)).documentElement;
  if (root === null) return false;
  const table = extractXfIsDate(root);
  return table.length === expected.length && table.every((isDate, at) => isDate === expected[at]);
}

/**
 * The General clones of one patch job's date styles (see the top of this file). Per
 * output: `begin()`, then `generalStyleOf` for each date-styled cell a number is
 * written into, then, when `requested` is above 0, `build()` for the output's styles
 * part. A null build means the output must be written again without the clones, after
 * `disable()`.
 */
export class StyleClones {
  /** The styles part's entry name: where a built part goes. */
  readonly entry: string;
  private readonly styles: Uint8Array | null;
  private readonly xfIsDate: readonly boolean[];
  private disabled: boolean;
  // The walk runs once per job, on the first request.
  private walked = false;
  private layout: StylesLayout | null = null;
  // Per job: each source's clone (null: it gets none), and each built part by the
  // key of its source list, so outputs with the same clones share one content object.
  private readonly cloneBySource = new Map<number, Uint8Array | null>();
  private readonly builtByKey = new Map<string, Uint8Array | null>();
  // Per output: the clones in first-use order, their sources, and each source's index.
  private readonly clones: Uint8Array[] = [];
  private readonly sources: number[] = [];
  private readonly indexBySource = new Map<number, number>();

  /**
   * `styles`: the bytes of the styles part the reader read `xfIsDate` from, named
   * `entry`, or null when cloning is off for the job.
   */
  constructor(styles: Uint8Array | null, entry: string, xfIsDate: readonly boolean[]) {
    this.styles = styles;
    this.entry = entry;
    this.xfIsDate = xfIsDate;
    this.disabled = styles === null;
  }

  /** Starts an output: no clone requested yet. */
  begin(): void {
    this.clones.length = 0;
    this.sources.length = 0;
    this.indexBySource.clear();
  }

  /** The clones the current output asked for. */
  get requested(): number {
    return this.sources.length;
  }

  /**
   * The index of the General clone of date style `style` in the current output: the
   * table's length plus the clone's ordinal in first-use order. Null when cloning is
   * off, the walk refused the styles part, `style` is not a date style of the table, or
   * its `xf` gets no clone.
   */
  generalStyleOf(style: number): number | null {
    if (this.disabled || this.xfIsDate[style] !== true) return null;
    const known = this.indexBySource.get(style);
    if (known !== undefined) return known;
    const clone = this.cloneOf(style);
    if (clone === null) return null;
    const index = this.xfIsDate.length + this.sources.length;
    this.clones.push(clone);
    this.sources.push(style);
    this.indexBySource.set(style, index);
    return index;
  }

  /**
   * The styles part with the current output's clones and its `count` updated; the
   * same object for every output whose clones come from the same sources in the same
   * order. Null when no clone was requested, when the part would exceed its patch
   * growth cap, or when the reader would not read it as the table followed by one
   * non-date entry per clone. Never mutate the result: it may be shared.
   */
  build(): Uint8Array | null {
    if (this.disabled || this.sources.length === 0) return null;
    const key = this.sources.join(SOURCE_KEY_SEPARATOR);
    const cached = this.builtByKey.get(key);
    if (cached !== undefined) return cached;
    const built = guarded(() => this.assemble());
    this.builtByKey.set(key, built);
    return built;
  }

  /** Turns cloning off for the rest of the job, the current output included. */
  disable(): void {
    this.disabled = true;
    this.begin();
  }

  private cloneOf(style: number): Uint8Array | null {
    const cached = this.cloneBySource.get(style);
    if (cached !== undefined) return cached;
    const layout = this.walk();
    const styles = this.styles;
    const clone =
      layout === null || styles === null
        ? null
        : guarded(() =>
            generalClone(styles, valueAt(layout.xfStarts, style), valueAt(layout.xfEnds, style)),
          );
    this.cloneBySource.set(style, clone);
    return clone;
  }

  private walk(): StylesLayout | null {
    if (this.walked) return this.layout;
    this.walked = true;
    const styles = this.styles;
    this.layout = styles === null ? null : guarded(() => walkStyles(styles, this.xfIsDate.length));
    return this.layout;
  }

  private assemble(): Uint8Array | null {
    const styles = this.styles;
    const layout = this.layout;
    if (styles === null || layout === null) return null;
    const count = this.xfIsDate.length + this.clones.length;
    const edits: ByteEdit[] = [];
    if (layout.countStart !== NO_OFFSET) {
      edits.push({
        start: layout.countStart,
        end: layout.countEnd,
        content: encoder.encode(String(count)),
      });
    }
    for (const clone of this.clones) {
      edits.push({ start: layout.cellXfsEnd, end: layout.cellXfsEnd, content: clone });
    }
    if (editedLength(0, styles.length, edits) > patchedPartCap(styles.length)) return null;
    const rebuilt = edited(styles, 0, styles.length, edits);
    const expected = [...this.xfIsDate, ...this.clones.map(() => false)];
    return readsAs(this.entry, rebuilt, expected) ? rebuilt : null;
  }
}
