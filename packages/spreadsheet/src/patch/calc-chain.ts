import { isUtf8 } from 'node:buffer';

import { SpreadsheetFileError } from '../errors';
import { CONTENT_TYPES_PART, readerFilePath, WORKBOOK_RELS_PART } from '../workbook-parts';
import { ZIP_REJECT_REASONS } from './reasons';
import { foldAsciiCase, metaEntryName } from './shared';
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
  isXmlSpace,
  localNameIs,
  nextMarkup,
  scanMarkup,
  SPACE,
  valueAt,
  XmlLexError,
  type XmlMarkup,
} from './xml-lexer';

// calcChain removal of the export path. A patch that drops a formula leaves Excel's
// calculation chain naming a cell that has none, so the chain goes: its relationship
// is cut from the workbook rels and its Override from the content types, and the
// caller drops the parts whose Override was cut (the confirmed calcChain parts).
//
// Both parts are walked with the strict lexer, every markup of them, with a depth
// counter. The content types part is not a reader part: the gate never budgeted or
// parsed it, so it must never reach a DOM. Only direct children of the root are
// looked at, by local name, as the reader finds relationships; a part the walk cannot
// read whole is refused: bytes that are not UTF-8, a declaration of another encoding,
// no root element, or an element below a direct child of the root. Attribute values are
// compared as raw bytes; a value whose bytes are not what XML reads (a reference, or
// a TAB, LF or CR, which attribute-value normalization turns into a space) cannot be
// classified that way and is refused instead of read as "not calcChain". So is a
// repeated attribute: the content types part never meets a parser that would refuse it.
//
// Part names are compared folding ASCII case (A-Z to a-z, nothing else), as OPC
// compares them. A Target is free text, so a calcChain path may name any part: an
// Override is cut only when it also carries exactly the calcChain content type, and
// one that names such a path with any other content type is refused. Cutting it would
// leave that part (the workbook itself, for `Target="Workbook.xml"`) on a Default
// content type, and Excel could not open the output.
//
// Bytes between markups are never read: a leading byte order mark is skipped by the
// search for the first '<' and kept in the result with the other untouched runs.
// Each result is assembled once, from the source minus the cut elements.
//
// The walker (cutRootChildren) and the attribute reader (literalAttributeText) are
// also the upload gate's: it walks the content types and every relationships part with
// them (unsafe-parts.ts, guards.ts), so the gate and this file read those parts alike.

export interface CalcChainRemoval {
  /** Zip entry names of the calcChain parts the workbook rels name, distinct. */
  readonly paths: readonly string[];
  /**
   * The PartName of every Override that was cut, without its leading '/', decoded and
   * not folded, distinct. Each carries exactly the calcChain content type, so these are
   * the confirmed calcChain parts; a path with no such Override may name any part.
   */
  readonly cutParts: readonly string[];
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
export type ChildSelector = (markup: XmlMarkup, attributes: readonly number[]) => boolean;

/** Checks the start tag of the root element just scanned into `markup`; throws to refuse it. */
export type RootCheck = (markup: XmlMarkup) => void;

const NO_ROOT_CHECK: RootCheck = () => undefined;

const CALC_CHAIN_RELATIONSHIP_TYPES: readonly string[] = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/calcChain',
];
const CALC_CHAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml';
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const TARGET_ATTRIBUTE = 'Target';
const OVERRIDE = 'Override';
const PART_NAME_ATTRIBUTE = 'PartName';
const CONTENT_TYPE_ATTRIBUTE = 'ContentType';
// An Override's PartName is the entry name with a leading '/'.
const PART_NAME_PREFIX = '/';
const NO_ATTRIBUTE = -1;
// '&' opens a character or entity reference inside an attribute value.
const AMPERSAND = 0x26;

// Depth (open elements) at which the root's tag, and its direct children's tags, are met.
const ROOT_DEPTH = 0;
const CHILD_DEPTH = 1;

// A value may start with U+FEFF, which the default decoder would drop.
const VALUE_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

const FOLDED_CALC_CHAIN_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(
  CALC_CHAIN_RELATIONSHIP_TYPES.map(foldAsciiCase),
);

/** CORRUPT_FILE `{ reason: 'package-part', entry }`, the message `Package part <detail>`. */
export function packagePartError(entry: string, detail: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', `Package part ${detail}`, {
    reason: ZIP_REJECT_REASONS.PACKAGE_PART,
    entry: metaEntryName(entry),
  });
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

/**
 * The value of the scanned tag's only attribute named exactly `name`, decoded; null
 * when it has none. Read only from a value whose bytes are what XML reads, so the text
 * can be compared: CORRUPT_FILE `package-part` for `entry` when the attribute repeats
 * or its value holds a reference, a TAB, an LF or a CR.
 */
export function literalAttributeText(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  name: string,
  entry: string,
): string | null {
  const attribute = onlyAttribute(bytes, markup, attributes, name, entry);
  if (attribute === NO_ATTRIBUTE) return null;
  const value = literalValue(bytes, attributes, attribute, entry, name);
  return VALUE_DECODER.decode(bytes.subarray(value.start, value.end));
}

/**
 * The raw bytes of the value of the scanned tag's only attribute named exactly `name`,
 * references and line breaks left in; null when it has none. CORRUPT_FILE
 * `package-part` for `entry` when the attribute repeats.
 */
export function attributeValueBytes(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  name: string,
  entry: string,
): Uint8Array | null {
  const attribute = onlyAttribute(bytes, markup, attributes, name, entry);
  if (attribute === NO_ATTRIBUTE) return null;
  return bytes.subarray(
    attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
    attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
  );
}

function isCalcChainType(bytes: Uint8Array, start: number, end: number): boolean {
  return CALC_CHAIN_RELATIONSHIP_TYPES.some((type) => bytesEqualAscii(bytes, start, end, type));
}

/**
 * Whether Type bytes [start, end) name a calcChain type once trimmed of S and folded
 * in ASCII case. Asked only of a Type that is not one byte for byte: a reader that
 * compares loosely would still find that chain, which is then never cut, so such a
 * Type is refused rather than left in place (fail closed).
 */
function namesCalcChainLoosely(bytes: Uint8Array, start: number, end: number): boolean {
  let from = start;
  let to = end;
  while (from < to && isXmlSpace(bytes[from])) from += 1;
  while (to > from && isXmlSpace(bytes[to - 1])) to -= 1;
  const folded = foldAsciiCase(VALUE_DECODER.decode(bytes.subarray(from, to)));
  return FOLDED_CALC_CHAIN_RELATIONSHIP_TYPES.has(folded);
}

/** Whether attribute `contentType` exists and its raw value is exactly the calcChain content type. */
function hasCalcChainContentType(
  bytes: Uint8Array,
  attributes: readonly number[],
  contentType: number,
): boolean {
  if (contentType === NO_ATTRIBUTE) return false;
  // Raw bytes: a value holding a reference, TAB, LF or CR is never equal, so it is refused too.
  return bytesEqualAscii(
    bytes,
    attributeField(attributes, contentType, ATTRIBUTE_VALUE_START),
    attributeField(attributes, contentType, ATTRIBUTE_VALUE_END),
    CALC_CHAIN_CONTENT_TYPE,
  );
}

/**
 * A processing instruction whose target is `xml` in any ASCII case must be the first
 * markup, its target exactly `xml`, and name no encoding but UTF-8 (the worksheet
 * index's rule): bytes another reader decodes in another encoding (UTF-7 spells '<' as
 * `+ADw-`) could hold markup this walk never sees. CORRUPT_FILE `package-part` otherwise.
 */
function assertUtf8Declaration(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  entry: string,
  first: boolean,
): void {
  if (!hasDeclarationTarget(bytes, markup)) return;
  if (!first || !isXmlDeclaration(bytes, markup)) {
    throw packagePartError(entry, 'has an xml processing instruction that is not its declaration');
  }
  if (!declaresUtf8(bytes, markup, attributes)) {
    throw packagePartError(entry, 'declares an encoding other than UTF-8');
  }
}

/**
 * Walks every markup of `bytes` with the lexer and asks `select` about each direct
 * child of the root; a selected child is cut from its '<' to the end of the element.
 * The part must be read exactly as the walk reads it, so CORRUPT_FILE `package-part`
 * for `entry` when its bytes are not UTF-8 or its declaration names another encoding,
 * on a lexer error, an end tag outside the root, a second root element, no root
 * element, an element below a direct child of the root (neither the content types nor
 * the relationships schema has one, and the walk would not read it), or a root that
 * never closes. A caller that only reads the children selects none; an error `select`
 * or `checkRoot` (given the root's start tag, none by default) throws passes through
 * unchanged.
 */
export function cutRootChildren(
  bytes: Uint8Array,
  entry: string,
  select: ChildSelector,
  checkRoot: RootCheck = NO_ROOT_CHECK,
): ElementCuts {
  if (!isUtf8(bytes)) throw packagePartError(entry, 'is not valid UTF-8');
  const markup = createMarkup();
  const attributes: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let depth = ROOT_DEPTH;
  let rootSeen = false;
  let cutOpen = false;
  let first = true;
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
            checkRoot(markup);
          } else if (depth > CHILD_DEPTH) {
            throw packagePartError(entry, 'has an element below a direct child of the root');
          } else if (select(markup, attributes)) {
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
          assertUtf8Declaration(bytes, markup, attributes, entry, first);
          break;
        default: {
          const _exhaustive: never = kind;
          throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
        }
      }
      first = false;
    }
  } catch (error) {
    if (!(error instanceof XmlLexError)) throw error;
    throw packagePartError(entry, `has markup outside the strict subset: ${error.message}`);
  }
  if (!rootSeen) throw packagePartError(entry, 'has no root element');
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
 * name its Target maps to (readerFilePath) to `paths` once. CORRUPT_FILE for a Type
 * that names calcChain only once trimmed and folded in ASCII case.
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
    if (!isCalcChainType(bytes, typeValue.start, typeValue.end)) {
      if (!namesCalcChainLoosely(bytes, typeValue.start, typeValue.end)) return false;
      throw packagePartError(
        WORKBOOK_RELS_PART,
        'has a calcChain relationship Type in another ASCII case or with surrounding spaces',
      );
    }
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

/**
 * Selects an `Override` whose PartName, folded in ASCII case, is in `partNames` (one
 * decode, one fold, one lookup), and adds that PartName without its leading '/' to
 * `cutParts` once. CORRUPT_FILE when such an Override does not carry exactly the
 * calcChain content type, or any Override repeats PartName or ContentType.
 */
function overrideSelector(
  bytes: Uint8Array,
  partNames: ReadonlySet<string>,
  cutParts: string[],
  seen: Set<string>,
): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, OVERRIDE)) return false;
    const partName = onlyAttribute(
      bytes,
      markup,
      attributes,
      PART_NAME_ATTRIBUTE,
      CONTENT_TYPES_PART,
    );
    const contentType = onlyAttribute(
      bytes,
      markup,
      attributes,
      CONTENT_TYPE_ATTRIBUTE,
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
    const name = VALUE_DECODER.decode(bytes.subarray(value.start, value.end));
    if (!partNames.has(foldAsciiCase(name))) return false;
    if (!hasCalcChainContentType(bytes, attributes, contentType)) {
      throw packagePartError(
        CONTENT_TYPES_PART,
        'has an Override of a calcChain path without the calcChain content type',
      );
    }
    // Every name in `partNames` starts with the prefix, which folding leaves alone.
    const part = name.slice(PART_NAME_PREFIX.length);
    if (!seen.has(part)) {
      seen.add(part);
      cutParts.push(part);
    }
    return true;
  };
}

/**
 * The calcChain parts the workbook rels name, and both parts without them: the
 * relationships whose raw Type is a calcChain type, and the content types' Override
 * elements whose PartName is '/' + one of their entry names, folding ASCII case, and
 * whose raw ContentType is the calcChain content type. Null when the rels name no
 * calcChain part; `contentTypes` is then never called, so the caller reads (and may
 * inflate) that part only when there is something to cut in it.
 *
 * The paths are attacker-chosen (Target is free text); this function only reports
 * them, and the PartNames of the Overrides it cut, and the caller decides what is safe
 * to drop.
 *
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'package-part', entry }` for a
 * part outside the lexer's strict subset, with a broken element structure, with a
 * repeated Type, Target, PartName or ContentType, with a value it cannot compare as
 * raw bytes, with a calcChain relationship that has no Target, with a Type that names
 * calcChain only in another ASCII case or with surrounding spaces, or with an
 * Override that names a calcChain path without the calcChain content type.
 */
export function planCalcChainRemoval(
  workbookRels: Uint8Array,
  contentTypes: () => Uint8Array,
): CalcChainRemoval | null {
  const paths: string[] = [];
  const relsCuts = cutRootChildren(
    workbookRels,
    WORKBOOK_RELS_PART,
    calcChainRelationshipSelector(workbookRels, paths, new Set()),
  );
  if (relsCuts.starts.length === 0) return null;
  const partNames: ReadonlySet<string> = new Set(
    paths.map((path) => foldAsciiCase(PART_NAME_PREFIX + path)),
  );
  const types = contentTypes();
  const cutParts: string[] = [];
  const overrideCuts = cutRootChildren(
    types,
    CONTENT_TYPES_PART,
    overrideSelector(types, partNames, cutParts, new Set()),
  );
  return {
    paths,
    cutParts,
    workbookRels: withoutCuts(workbookRels, relsCuts),
    contentTypes: overrideCuts.starts.length === 0 ? null : withoutCuts(types, overrideCuts),
  };
}
