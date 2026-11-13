import { MAX_ERROR_CAUSE_LENGTH } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { CONTENT_TYPES_PART, readerFilePath, WORKBOOK_RELS_PART } from '../workbook-parts';
import { ZIP_REJECT_REASONS } from './reasons';
import { valueAt } from './sheet-index';
import {
  ATTRIBUTE_FIELDS,
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  bytesEqualAscii,
  createMarkup,
  isXmlSpace,
  localNameStart,
  nextMarkup,
  scanMarkup,
  XmlLexError,
  type XmlMarkup,
} from './xml-lexer';

// calcChain removal of the export path. A patch that drops a formula leaves Excel's
// calculation chain naming a cell that has none, so the chain goes: its relationship
// is cut from the workbook rels and its Override from the content types, and the
// caller drops the parts themselves.
//
// Both parts are walked with the strict lexer, every markup of them, with a depth
// counter. The content types part is not a reader part: the gate never budgeted or
// parsed it, so it must never reach a DOM. Only direct children of the root are
// looked at, by local name, as the reader finds relationships. Attribute values are
// compared as raw bytes; a value whose bytes are not what XML reads (a reference, or
// a TAB, LF or CR, which attribute-value normalization turns into a space) cannot be
// classified that way and is refused instead of read as "not calcChain". So is a
// repeated attribute: the content types part never meets a parser that would refuse it.
//
// Bytes between markups are never read: a leading byte order mark is skipped by the
// search for the first '<' and kept in the result with the other untouched runs.
// Each result is assembled once, from the source minus the cut elements.

export interface CalcChainRemoval {
  /** Zip entry names of the calcChain parts the workbook rels name, distinct. */
  readonly paths: readonly string[];
  /** The workbook rels without those relationships. */
  readonly workbookRels: Uint8Array;
  /** The content types without their Override elements; null when there was none to cut. */
  readonly contentTypes: Uint8Array | null;
}

/** Elements to cut, as byte ranges [start, end) in document order; parallel arrays. */
interface ElementCuts {
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/** Whether the direct child of the root just scanned into `markup` is to be cut. */
type ChildSelector = (markup: XmlMarkup, attributes: readonly number[]) => boolean;

const CALC_CHAIN_RELATIONSHIP_TYPES: readonly string[] = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/calcChain',
];
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const TARGET_ATTRIBUTE = 'Target';
const OVERRIDE = 'Override';
const PART_NAME_ATTRIBUTE = 'PartName';
// An Override's PartName is the entry name with a leading '/'.
const PART_NAME_PREFIX = '/';
const NO_ATTRIBUTE = -1;
const SPACE = 0x20;
// '&' opens a character or entity reference inside an attribute value.
const AMPERSAND = 0x26;

// Depth (open elements) at which the root's tag, and its direct children's tags, are met.
const ROOT_DEPTH = 0;
const CHILD_DEPTH = 1;

// A value may start with U+FEFF, which the default decoder would drop.
const VALUE_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

function packagePartError(entry: string, detail: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', `Package part ${detail}`, {
    reason: ZIP_REJECT_REASONS.PACKAGE_PART,
    entry: entry.slice(0, MAX_ERROR_CAUSE_LENGTH),
  });
}

function attributeField(attributes: readonly number[], attribute: number, field: number): number {
  return valueAt(attributes, attribute * ATTRIBUTE_FIELDS + field);
}

/**
 * The index of the scanned tag's only attribute named exactly `name` (qualified name,
 * as `getAttribute` matches it), NO_ATTRIBUTE when it has none. CORRUPT_FILE when it
 * has two.
 */
function onlyAttribute(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  name: string,
  entry: string,
): number {
  let found = NO_ATTRIBUTE;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (!bytesEqualAscii(bytes, nameStart, nameEnd, name)) continue;
    if (found !== NO_ATTRIBUTE) throw packagePartError(entry, `has a repeated ${name} attribute`);
    found = attribute;
  }
  return found;
}

/**
 * Whether raw value bytes [start, end) are exactly what XML reads: no reference and
 * no TAB, LF or CR (normalized to a space). Only such a value can be compared as bytes.
 */
function isLiteralValue(bytes: Uint8Array, start: number, end: number): boolean {
  for (let at = start; at < end; at += 1) {
    const byte = bytes[at];
    if (byte === AMPERSAND || (byte !== SPACE && isXmlSpace(byte))) return false;
  }
  return true;
}

/** Raw bytes of attribute `attribute`'s value; CORRUPT_FILE when they are not literal. */
function literalValue(
  bytes: Uint8Array,
  attributes: readonly number[],
  attribute: number,
  entry: string,
  name: string,
): { readonly start: number; readonly end: number } {
  const start = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
  const end = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
  if (!isLiteralValue(bytes, start, end)) {
    throw packagePartError(entry, `has a ${name} value holding a reference or a line break`);
  }
  return { start, end };
}

function isCalcChainType(bytes: Uint8Array, start: number, end: number): boolean {
  return CALC_CHAIN_RELATIONSHIP_TYPES.some((type) => bytesEqualAscii(bytes, start, end, type));
}

function localNameIs(bytes: Uint8Array, markup: XmlMarkup, name: string): boolean {
  return bytesEqualAscii(bytes, localNameStart(bytes, markup), markup.nameEnd, name);
}

/**
 * Walks every markup of `bytes` with the lexer and asks `select` about each direct
 * child of the root; a selected child is cut from its '<' to the end of the element.
 * CORRUPT_FILE `package-part` for `entry` on a lexer error, an end tag outside the
 * root, a second root element, or a root that never closes.
 */
function cutRootChildren(bytes: Uint8Array, entry: string, select: ChildSelector): ElementCuts {
  const markup = createMarkup();
  const attributes: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let depth = ROOT_DEPTH;
  let rootSeen = false;
  let cutOpen = false;
  try {
    for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
      scanMarkup(bytes, at, markup, attributes);
      const kind = markup.kind;
      switch (kind) {
        case 'start':
        case 'empty':
          if (depth === ROOT_DEPTH) {
            if (rootSeen) throw packagePartError(entry, 'has an element after the root element');
            rootSeen = true;
          } else if (depth === CHILD_DEPTH && select(markup, attributes)) {
            starts.push(markup.start);
            if (kind === 'empty') ends.push(markup.end);
            else cutOpen = true;
          }
          if (kind === 'start') depth += 1;
          break;
        case 'end':
          if (depth === ROOT_DEPTH) {
            throw packagePartError(entry, 'has an end tag outside the root element');
          }
          depth -= 1;
          if (depth === CHILD_DEPTH && cutOpen) {
            ends.push(markup.end);
            cutOpen = false;
          }
          break;
        case 'opaque':
          break;
        default: {
          const _exhaustive: never = kind;
          throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof XmlLexError)) throw error;
    throw packagePartError(entry, `has markup outside the strict subset: ${error.message}`);
  }
  if (depth !== ROOT_DEPTH) throw packagePartError(entry, 'ends inside the root element');
  return { starts, ends };
}

/** `bytes` without the cut ranges, in one allocation. */
function withoutCuts(bytes: Uint8Array, cuts: ElementCuts): Uint8Array {
  let removed = 0;
  for (let cut = 0; cut < cuts.starts.length; cut += 1) {
    removed += valueAt(cuts.ends, cut) - valueAt(cuts.starts, cut);
  }
  const result = new Uint8Array(bytes.length - removed);
  let cursor = 0;
  let written = 0;
  for (let cut = 0; cut < cuts.starts.length; cut += 1) {
    const start = valueAt(cuts.starts, cut);
    result.set(bytes.subarray(cursor, start), written);
    written += start - cursor;
    cursor = valueAt(cuts.ends, cut);
  }
  result.set(bytes.subarray(cursor), written);
  return result;
}

/**
 * Selects a `Relationship` whose raw Type is a calcChain type, and adds the entry
 * name its Target maps to (readerFilePath) to `paths` once.
 */
function calcChainRelationshipSelector(
  bytes: Uint8Array,
  paths: string[],
  seen: Set<string>,
): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
    const type = onlyAttribute(bytes, markup, attributes, TYPE_ATTRIBUTE, WORKBOOK_RELS_PART);
    const target = onlyAttribute(bytes, markup, attributes, TARGET_ATTRIBUTE, WORKBOOK_RELS_PART);
    if (type === NO_ATTRIBUTE) return false;
    const typeValue = literalValue(bytes, attributes, type, WORKBOOK_RELS_PART, TYPE_ATTRIBUTE);
    if (!isCalcChainType(bytes, typeValue.start, typeValue.end)) return false;
    if (target === NO_ATTRIBUTE) {
      throw packagePartError(WORKBOOK_RELS_PART, 'has a calcChain relationship without a Target');
    }
    const targetValue = literalValue(
      bytes,
      attributes,
      target,
      WORKBOOK_RELS_PART,
      TARGET_ATTRIBUTE,
    );
    const path = readerFilePath(
      VALUE_DECODER.decode(bytes.subarray(targetValue.start, targetValue.end)),
    );
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
    return true;
  };
}

/** Selects an `Override` whose raw PartName is in `partNames`: one decode, one lookup. */
function overrideSelector(bytes: Uint8Array, partNames: ReadonlySet<string>): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, OVERRIDE)) return false;
    const partName = onlyAttribute(
      bytes,
      markup,
      attributes,
      PART_NAME_ATTRIBUTE,
      CONTENT_TYPES_PART,
    );
    if (partName === NO_ATTRIBUTE) return false;
    const value = literalValue(
      bytes,
      attributes,
      partName,
      CONTENT_TYPES_PART,
      PART_NAME_ATTRIBUTE,
    );
    return partNames.has(VALUE_DECODER.decode(bytes.subarray(value.start, value.end)));
  };
}

/**
 * The calcChain parts the workbook rels name, and both parts without them: the
 * relationships whose raw Type is a calcChain type, and the content types' Override
 * elements whose raw PartName is '/' + one of their entry names. Null when the rels
 * name no calcChain part; the content types are then not read at all.
 *
 * The paths are attacker-chosen (Target is free text); this function only reports
 * them, the caller decides whether dropping them is safe.
 *
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'package-part', entry }` for a
 * part outside the lexer's strict subset, with a broken element structure, with a
 * repeated Type, Target or PartName, with a value it cannot compare as raw bytes, or
 * with a calcChain relationship that has no Target.
 */
export function planCalcChainRemoval(
  workbookRels: Uint8Array,
  contentTypes: Uint8Array,
): CalcChainRemoval | null {
  const paths: string[] = [];
  const relsCuts = cutRootChildren(
    workbookRels,
    WORKBOOK_RELS_PART,
    calcChainRelationshipSelector(workbookRels, paths, new Set()),
  );
  if (relsCuts.starts.length === 0) return null;
  const partNames: ReadonlySet<string> = new Set(paths.map((path) => PART_NAME_PREFIX + path));
  const overrideCuts = cutRootChildren(
    contentTypes,
    CONTENT_TYPES_PART,
    overrideSelector(contentTypes, partNames),
  );
  return {
    paths,
    workbookRels: withoutCuts(workbookRels, relsCuts),
    contentTypes: overrideCuts.starts.length === 0 ? null : withoutCuts(contentTypes, overrideCuts),
  };
}
