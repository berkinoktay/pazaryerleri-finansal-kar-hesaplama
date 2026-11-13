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
import { localNameIs } from './patch/xml-lexer';
import { CONTENT_TYPES_PART, UNSAFE_PART_NAMES, UNSAFE_PART_PREFIXES } from './workbook-parts';

// Active package parts: a macro project, a macro or dialog sheet, an embedded object
// or package, an ActiveX control and an external link. The byte-preserving export hands
// every part of a stored upload unchanged to whoever exports it, so the gate refuses
// such a part wherever it sits in the archive, found the way Excel finds it:
//   - by its content type: every Default and Override of the content types part;
//   - by its relationship type: every Relationship of every relationships part the
//     gate keeps (the entries named .xml.rels); the Target is never read, because the
//     declaration is what Excel follows, wherever it points;
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
];

const UNSAFE_ENDINGS: ReadonlySet<string> = new Set(UNSAFE_RELATIONSHIP_TYPE_ENDINGS);
// Every relationships part ends with this; the gate keeps those that end with the second.
const RELS_SUFFIX = '.rels';
const XML_RELS_SUFFIX = '.xml.rels';
const FOLDED_CONTENT_TYPES_PART = foldAsciiCase(CONTENT_TYPES_PART);
const TYPE_SEGMENT_SEPARATOR = '/';
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const DEFAULT = 'Default';
const OVERRIDE = 'Override';
const CONTENT_TYPE_ATTRIBUTE = 'ContentType';

function unsafePartError(entry: string, message: string): SpreadsheetFileError {
  return new SpreadsheetFileError('UNSAFE_CONTENT', message, {
    reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART,
    entry: metaEntryName(entry),
  });
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` when
 * relationship Type text names an active part: its last '/' segment, trimmed and
 * ASCII-folded, equals one of UNSAFE_RELATIONSHIP_TYPE_ENDINGS (`packageOther` does not
 * end in `package`). `entry` is the relationships part the Type was read from.
 */
export function assertSafeRelationshipType(type: string, entry: string): void {
  const trimmed = type.trim();
  const ending = trimmed.slice(trimmed.lastIndexOf(TYPE_SEGMENT_SEPARATOR) + 1);
  if (!UNSAFE_ENDINGS.has(foldAsciiCase(ending))) return;
  throw unsafePartError(entry, 'Workbook declares a relationship to an active part');
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
 * neither keeps nor walks such an entry under that name, and another reader, which
 * compares part names folding ASCII case, may follow it.
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

/** Refuses a Relationship whose Type names an active part. */
function relationshipSelector(bytes: Uint8Array, entry: string): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
    const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, entry);
    if (type !== null) assertSafeRelationshipType(type, entry);
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
 * ContentType holds a marker, and no Relationship of a kept relationships part whose
 * Type ends in an unsafe segment.
 *
 * Throws SpreadsheetFileError: UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` for an
 * unsafe declaration; UNSAFE_CONTENT (no reason) when the content scan refuses a part
 * it walks; CORRUPT_FILE `{ reason: 'package-part', entry }` for a misspelled entry,
 * markup outside the lexer's strict subset, a broken element structure, a repeated
 * ContentType or Type, or a ContentType or Type value that holds a reference or a line
 * break (it could not be compared byte for byte).
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
    if (name.endsWith(RELS_SUFFIX)) walkPart(name, bytes, relationshipSelector(bytes, name));
  }
}
