import { assertSafeXmlPart, decodeXmlText } from './content-scan';
import type { SpreadsheetFileError } from './errors';
import {
  attributeValueBytes,
  cutRootChildren,
  literalAttributeText,
  packagePartError,
  type ChildSelector,
} from './patch/calc-chain';
import { UNSAFE_CONTENT_REASONS } from './patch/reasons';
import { foldAsciiCase, unsafeContentError } from './patch/shared';
import { localNameIs, type XmlMarkup } from './patch/xml-lexer';
import { CONTENT_TYPES_PART, UNSAFE_PART_NAMES, UNSAFE_PART_PREFIXES } from './workbook-parts';

// Active package parts: a macro project, a macro, international macro or dialog sheet,
// an embedded object or package, an ActiveX control, an external link, a data
// connection or query table, an Office web add-in or its task pane, a custom ribbon
// (customUI) or attached toolbars, and any relationship to content outside the package.
// The byte-preserving export hands every part of a stored upload unchanged to whoever
// exports it, so the gate refuses such a part wherever it sits in the archive, found the
// way Excel finds it:
//   - by its content type: every Default and Override of the content types part;
//   - by its relationship type: every Relationship of every relationships part (every
//     entry whose ASCII-folded name ends with .rels, whatever the part it belongs to:
//     `chart1.bin.rels` is followed like `chart1.xml.rels`);
//   - by its target (assertSafeTarget): a relationship whose TargetMode is not
//     `Internal` loads content from outside the package (a linked picture, an OLE link,
//     a web image), except a hyperlink of a worksheet to an http, https or mailto
//     address, which only opens when the reader clicks the cell; and an internal Target
//     that is a URI with a scheme, a drive letter, a network path or holds a backslash
//     leaves the package all the same;
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
  'webextension',
  'customui',
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
  'webextension',
  'webextensiontaskpanes',
  'extensibility',
  'attachedtoolbars',
];

const UNSAFE_ENDINGS: ReadonlySet<string> = new Set(UNSAFE_RELATIONSHIP_TYPE_ENDINGS);
// Every relationships part ends with this; an XML part's relationships part with the second.
const RELS_SUFFIX = '.rels';
const XML_RELS_SUFFIX = '.xml.rels';
const FOLDED_CONTENT_TYPES_PART = foldAsciiCase(CONTENT_TYPES_PART);
const TYPE_SEGMENT_SEPARATOR = '/';
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const TARGET_ATTRIBUTE = 'Target';
const TARGET_MODE_ATTRIBUTE = 'TargetMode';
// The only TargetMode a relationship to content inside the package carries, when it has one.
const INTERNAL_TARGET_MODE = 'Internal';
// The ASCII-folded last Type segment of the one relationship that may point outside.
const HYPERLINK_TYPE_ENDING = 'hyperlink';
// The relationships part of a worksheet: this folder, a name without '/', XML_RELS_SUFFIX.
const WORKSHEET_RELS_FOLDER = 'xl/worksheets/_rels/';
// The ASCII-folded starts of the only targets an external worksheet hyperlink may have.
const HYPERLINK_TARGET_STARTS: readonly string[] = ['http://', 'https://', 'mailto:'];
const DEFAULT = 'Default';
const OVERRIDE = 'Override';
const CONTENT_TYPE_ATTRIBUTE = 'ContentType';

// UTF-16 code units of an internal Target's checks: a URI scheme is an ASCII letter, then
// letters, digits, '+', '.' or '-', then ':' (a drive letter `C:` is one); a network path
// starts with two slashes; Windows reads a backslash anywhere in a path.
const SCHEME_COLON = 0x3a;
const PLUS = 0x2b;
const PERIOD = 0x2e;
const HYPHEN = 0x2d;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const NETWORK_PATH_START = '//';
const BACKSLASH = '\\';
// Code units a URI reader trims from both ends of a Target: controls and the space.
const MAX_TRIMMED_CODE = 0x20;

function unsafePartError(entry: string, message: string): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_PART, entry, message);
}

/** `type` from just past its last '/', ASCII-folded. */
function foldedLastSegment(type: string): string {
  return foldAsciiCase(type.slice(type.lastIndexOf(TYPE_SEGMENT_SEPARATOR) + 1));
}

/**
 * Whether the gate walks entry `name` as a relationships part: its ASCII-folded name
 * ends with `.rels`. Every such entry the gate keeps (all whose content is XML), whatever
 * part it belongs to; none is a reader part.
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

/** Whether `entry`, ASCII-folded, is `xl/worksheets/_rels/<name>.xml.rels`, `<name>` holding no '/'. */
function isWorksheetRelationshipsPart(entry: string): boolean {
  const folded = foldAsciiCase(entry);
  if (!folded.startsWith(WORKSHEET_RELS_FOLDER) || !folded.endsWith(XML_RELS_SUFFIX)) return false;
  const name = folded.slice(WORKSHEET_RELS_FOLDER.length, -XML_RELS_SUFFIX.length);
  return name.length > 0 && !name.includes(TYPE_SEGMENT_SEPARATOR);
}

function isAsciiLetter(code: number): boolean {
  return (code >= UPPER_A && code <= UPPER_Z) || (code >= LOWER_A && code <= LOWER_Z);
}

function isSchemeCharacter(code: number): boolean {
  return (
    isAsciiLetter(code) ||
    (code >= DIGIT_ZERO && code <= DIGIT_NINE) ||
    code === PLUS ||
    code === PERIOD ||
    code === HYPHEN
  );
}

/** Whether `target` starts with a URI scheme: an ASCII letter, scheme characters, then ':'. */
function startsWithScheme(target: string): boolean {
  if (!isAsciiLetter(target.charCodeAt(0))) return false;
  for (let at = 1; at < target.length; at += 1) {
    const code = target.charCodeAt(at);
    if (code === SCHEME_COLON) return true;
    if (!isSchemeCharacter(code)) return false;
  }
  return false;
}

/** `text` without the code units up to U+0020 at either end, the ones a URI reader trims. */
function trimmedTarget(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= MAX_TRIMMED_CODE) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= MAX_TRIMMED_CODE) end -= 1;
  return text.slice(start, end);
}

/** Whether an internal relationship's decoded `target` leaves the package all the same. */
function leavesPackage(target: string): boolean {
  const trimmed = trimmedTarget(target);
  return (
    startsWithScheme(trimmed) ||
    trimmed.startsWith(NETWORK_PATH_START) ||
    trimmed.includes(BACKSLASH)
  );
}

/** Whether an external relationship of `type` in `entry` to `target` is a worksheet hyperlink to a web or mail address. */
function isWorksheetWebHyperlink(
  type: string | null,
  entry: string,
  target: string | null,
): boolean {
  if (type === null || target === null) return false;
  if (foldedLastSegment(type) !== HYPERLINK_TYPE_ENDING || !isWorksheetRelationshipsPart(entry)) {
    return false;
  }
  const folded = foldAsciiCase(target);
  return HYPERLINK_TARGET_STARTS.some((start) => folded.startsWith(start));
}

/**
 * The decoded Target of the Relationship scanned into `markup`, null without one.
 * CORRUPT_FILE `package-part` for `entry` when it repeats or holds a reference the walk
 * cannot decode.
 */
function relationshipTarget(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  entry: string,
): string | null {
  const raw = attributeValueBytes(bytes, markup, attributes, TARGET_ATTRIBUTE, entry);
  if (raw === null) return null;
  const target = decodeXmlText(raw);
  if (target === null) throw packagePartError(entry, 'has a Target the walk cannot decode');
  return target;
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` when the
 * Relationship scanned into `markup`, of `type` (null without one) and read from
 * relationships part `entry`, reaches outside the package:
 *   - it has a TargetMode that is not exactly `Internal`, unless its type's last '/'
 *     segment, ASCII-folded, is exactly `hyperlink`, `entry` is a worksheet's
 *     relationships part (`xl/worksheets/_rels/<name>.xml.rels`, ASCII-folded) and its
 *     Target, ASCII-folded, starts with `http://`, `https://` or `mailto:`;
 *   - or it is internal and its decoded Target, trimmed of controls and spaces, starts
 *     with a URI scheme or a drive letter, starts with `//`, or holds a backslash.
 * CORRUPT_FILE `package-part` when the TargetMode or the Target repeats, the TargetMode
 * holds a reference or a line break, or the Target a reference the walk cannot decode.
 */
export function assertSafeTarget(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  type: string | null,
  entry: string,
): void {
  const mode = literalAttributeText(bytes, markup, attributes, TARGET_MODE_ATTRIBUTE, entry);
  const target = relationshipTarget(bytes, markup, attributes, entry);
  if (mode !== null && mode !== INTERNAL_TARGET_MODE) {
    if (isWorksheetWebHyperlink(type, entry, target)) return;
    throw unsafePartError(entry, 'Workbook declares a relationship to external content');
  }
  if (target !== null && leavesPackage(target)) {
    throw unsafePartError(
      entry,
      'Workbook declares an internal relationship that leaves the package',
    );
  }
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

/** Refuses a Relationship whose Type names an active part, or whose target reaches outside the package. */
function relationshipSelector(bytes: Uint8Array, entry: string): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
    const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, entry);
    if (type !== null) assertSafeRelationshipType(type, entry);
    assertSafeTarget(bytes, markup, attributes, type, entry);
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
 * kept entry named `.rels`) whose Type ends in an unsafe segment or whose target reaches
 * outside the package (assertSafeTarget).
 *
 * Throws SpreadsheetFileError: UNSAFE_CONTENT `{ reason: 'unsafe-part', entry }` for an
 * unsafe declaration; UNSAFE_CONTENT when the content scan refuses a part it walks;
 * CORRUPT_FILE `{ reason: 'package-part', entry }` for a misspelled entry, a part the
 * walk cannot read whole (not UTF-8, a declaration of another encoding, no root element,
 * an element below a direct child of the root), markup outside the lexer's strict
 * subset, a broken element structure, a repeated ContentType, Type, Target or
 * TargetMode, a ContentType, Type or TargetMode that holds a reference or a line break
 * (it could not be compared byte for byte), or a Target the walk cannot decode.
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
