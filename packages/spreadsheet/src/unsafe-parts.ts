import { assertSafeXmlPart } from './content-scan';
import { SpreadsheetFileError } from './errors';
import {
  cutRootChildren,
  literalAttributeText,
  packagePartError,
  type ChildSelector,
} from './patch/calc-chain';
import { UNSAFE_CONTENT_REASONS } from './patch/reasons';
import { foldAsciiCase, metaEntryName } from './patch/shared';
import { localNameIs, type XmlMarkup } from './patch/xml-lexer';
import { CONTENT_TYPES_PART, UNSAFE_PART_NAMES, UNSAFE_PART_PREFIXES } from './workbook-parts';

// Active package parts: a macro project, a macro, international macro or dialog sheet,
// an embedded object or package, an ActiveX control, an external link, a data
// connection or query table, and any relationship to external content. The
// byte-preserving export hands every part of a stored upload unchanged to whoever
// exports it, so the gate refuses such a part wherever it sits in the archive, found the
// way Excel finds it:
//   - by its content type: every Default and Override of the content types part;
//   - by its relationship type: every Relationship of every relationships part (every
//     entry whose ASCII-folded name ends with .rels, whatever the part it belongs to:
//     `chart1.bin.rels` is followed like `chart1.xml.rels`); the Target is never read,
//     because the declaration is what Excel follows, wherever it points;
//   - by its target mode: a relationship whose TargetMode is not `Internal` loads
//     content from outside the package (a linked picture, an OLE link), except a
//     hyperlink, which only opens when the reader clicks it;
//   - by its name, a second line only (assertNoUnsafePartNames): a relationship Target
//     is free text, so `xl/x/a.xml` can be an external link.
// Each part is content-scanned, then walked with the strict lexer the calcChain cut
// uses (cutRootChildren), every markup of it; nothing reaches a DOM, and each walk is
// one linear pass over bytes the decompression cap already bounds.

/** ASCII-folded fragments of the content types of active parts: a content type that holds one is refused. */
export const UNSAFE_CONTENT_TYPE_MARKERS: readonly string[] = [
  'vbaproject',
  'macroenabled',
  'externallink',
  'oleobject',
  'activex',
  'macrosheet',
  'dialogsheet',
  'connections+xml',
  'querytable+xml',
];
/** ASCII-folded last segments of the relationship types of active parts, compared whole. */
export const UNSAFE_RELATIONSHIP_TYPE_ENDINGS: readonly string[] = [
  'vbaproject',
  'externallink',
  'oleobject',
  'package',
  'control',
  'xlmacrosheet',
  'dialogsheet',
  'xlintlmacrosheet',
  'connections',
  'querytable',
];

const UNSAFE_ENDINGS: ReadonlySet<string> = new Set(UNSAFE_RELATIONSHIP_TYPE_ENDINGS);
// Every relationships part ends with this; an XML part's relationships part with the second.
const RELS_SUFFIX = '.rels';
const XML_RELS_SUFFIX = '.xml.rels';
const FOLDED_CONTENT_TYPES_PART = foldAsciiCase(CONTENT_TYPES_PART);
const TYPE_SEGMENT_SEPARATOR = '/';
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const TARGET_MODE_ATTRIBUTE = 'TargetMode';
// The only TargetMode a relationship to content inside the package carries, when it has one.
const INTERNAL_TARGET_MODE = 'Internal';
// The ASCII-folded last Type segment of the one relationship that may point outside.
const HYPERLINK_TYPE_ENDING = 'hyperlink';
const DEFAULT = 'Default';
const OVERRIDE = 'Override';
const CONTENT_TYPE_ATTRIBUTE = 'ContentType';

function unsafePartError(entry: string, message: string): SpreadsheetFileError {
  return new SpreadsheetFileError('UNSAFE_CONTENT', message, {
    reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART,
    entry: metaEntryName(entry),
  });
}

/** `type` from just past its last '/', ASCII-folded. */
function foldedLastSegment(type: string): string {
  return foldAsciiCase(type.slice(type.lastIndexOf(TYPE_SEGMENT_SEPARATOR) + 1));
}

/**
 * Whether the gate walks entry `name` as a relationships part: its ASCII-folded name
 * ends with `.rels`. The stream keeps the content of every such entry (the root
 * relationships part apart), whatever part it belongs to; none is a reader part.
 */
export function isRelationshipsPartName(name: string): boolean {
  return foldAsciiCase(name).endsWith(RELS_SUFFIX);
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` when
 * relationship Type text names an active part: its last '/' segment, trimmed and
 * ASCII-folded, equals one of UNSAFE_RELATIONSHIP_TYPE_ENDINGS (`packageOther` does not
 * end in `package`). `entry` is the relationships part the Type was read from.
 */
export function assertSafeRelationshipType(type: string, entry: string): void {
  if (!UNSAFE_ENDINGS.has(foldedLastSegment(type.trim()))) return;
  throw unsafePartError(entry, 'Workbook declares a relationship to an active part');
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` when the
 * Relationship scanned into `markup` points outside the package: it has a TargetMode
 * that is not exactly `Internal`, and its `type` (null without one) is not a hyperlink
 * type (last '/' segment, ASCII-folded, exactly `hyperlink`). CORRUPT_FILE
 * `package-part` when the TargetMode repeats or holds a reference or a line break.
 */
export function assertInternalTarget(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  type: string | null,
  entry: string,
): void {
  const mode = literalAttributeText(bytes, markup, attributes, TARGET_MODE_ATTRIBUTE, entry);
  if (mode === null || mode === INTERNAL_TARGET_MODE) return;
  if (type !== null && foldedLastSegment(type) === HYPERLINK_TYPE_ENDING) return;
  throw unsafePartError(entry, 'Workbook declares a relationship to external content');
}

function isUnsafeContentType(contentType: string): boolean {
  const folded = foldAsciiCase(contentType);
  return UNSAFE_CONTENT_TYPE_MARKERS.some((marker) => folded.includes(marker));
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` for an
 * entry whose ASCII-folded name is one of UNSAFE_PART_NAMES or starts with one of
 * UNSAFE_PART_PREFIXES. Reads names only; nothing is inflated.
 */
export function assertNoUnsafePartNames(names: Iterable<string>): void {
  for (const name of names) {
    const folded = foldAsciiCase(name);
    const unsafe =
      UNSAFE_PART_NAMES.includes(folded) ||
      UNSAFE_PART_PREFIXES.some((prefix) => folded.startsWith(prefix));
    if (unsafe) {
      throw unsafePartError(name, 'Workbook holds a macro, embedded or external link part');
    }
  }
}

/**
 * CORRUPT_FILE `package-part` for an entry whose ASCII-folded name ends with `.rels` or
 * `.xml.rels`, or is the content types part, while its own spelling does not: the gate
 * looks such parts up by their exact names, and another reader, which compares part
 * names folding ASCII case, may follow it under the name it folds to.
 */
function assertWalkedSpelling(name: string): void {
  const folded = foldAsciiCase(name);
  const misspelled =
    (folded.endsWith(XML_RELS_SUFFIX) && !name.endsWith(XML_RELS_SUFFIX)) ||
    (folded.endsWith(RELS_SUFFIX) && !name.endsWith(RELS_SUFFIX)) ||
    (folded === FOLDED_CONTENT_TYPES_PART && name !== CONTENT_TYPES_PART);
  if (misspelled) {
    throw packagePartError(name, 'is named in another ASCII case than the gate reads it');
  }
}

/** Refuses a Default or Override whose ContentType holds an unsafe marker. */
function contentTypeSelector(bytes: Uint8Array): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, DEFAULT) && !localNameIs(bytes, markup, OVERRIDE)) return false;
    const contentType = literalAttributeText(
      bytes,
      markup,
      attributes,
      CONTENT_TYPE_ATTRIBUTE,
      CONTENT_TYPES_PART,
    );
    if (contentType !== null && isUnsafeContentType(contentType)) {
      throw unsafePartError(
        CONTENT_TYPES_PART,
        'Workbook declares the content type of an active part',
      );
    }
    return false;
  };
}

/** Refuses a Relationship whose Type names an active part, or that points outside the package. */
function relationshipSelector(bytes: Uint8Array, entry: string): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
    const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, entry);
    if (type !== null) assertSafeRelationshipType(type, entry);
    assertInternalTarget(bytes, markup, attributes, type, entry);
    return false;
  };
}

/** The content scan, then one lexer walk that selects nothing. */
function walkPart(entry: string, bytes: Uint8Array, select: ChildSelector): void {
  assertSafeXmlPart(entry, bytes);
  cutRootChildren(bytes, entry, select);
}

/**
 * The type rule of the gate, on the name of every entry and the content of the entries
 * the gate keeps: no entry spelled in another ASCII case than a part the rule walks
 * (assertWalkedSpelling), no Default or Override of the content types part whose
 * ContentType holds a marker, and no Relationship of a kept relationships part (every
 * kept entry named `.rels`) whose Type ends in an unsafe segment or whose TargetMode
 * points outside the package (assertInternalTarget).
 *
 * Throws SpreadsheetFileError: UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` for an
 * unsafe declaration; UNSAFE_CONTENT (no reason) when the content scan refuses a part
 * it walks; CORRUPT_FILE `{ reason: 'package-part', entry }` for a misspelled entry,
 * a part the walk cannot read whole (not UTF-8, a declaration of another encoding, no
 * root element, an element below a direct child of the root), markup outside the
 * lexer's strict subset, a broken element structure, a repeated ContentType, Type or
 * TargetMode, or such a value that holds a reference or a line break (it could not be
 * compared byte for byte).
 */
export function assertNoUnsafePackageParts(
  names: Iterable<string>,
  contents: ReadonlyMap<string, Uint8Array>,
): void {
  for (const name of names) assertWalkedSpelling(name);
  const contentTypes = contents.get(CONTENT_TYPES_PART);
  if (contentTypes !== undefined) {
    walkPart(CONTENT_TYPES_PART, contentTypes, contentTypeSelector(contentTypes));
  }
  for (const [name, bytes] of contents) {
    if (isRelationshipsPartName(name)) walkPart(name, bytes, relationshipSelector(bytes, name));
  }
}
