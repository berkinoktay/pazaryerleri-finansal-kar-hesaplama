import {
  assertSafeXmlPart,
  createFormulaScanBudget,
  decodeXmlText,
  NO_HYPERLINK_IDS,
  opensLooseElement,
  type ContentScanPlan,
  type ContentScanStep,
  type ExternalHyperlinkIds,
  type FormulaScanBudget,
  type WorksheetHyperlinkIds,
} from './content-scan';
import type { SpreadsheetFileError } from './errors';
import type { PackageCensusCollector } from './package-census';
import {
  attributeValueBytes,
  cutRootChildren,
  literalAttributeText,
  packagePartError,
  type ChildSelector,
  type RootCheck,
} from './patch/calc-chain';
import { SPREADSHEET_MAIN_NAMESPACES } from './patch/limits';
import {
  UNSAFE_CONTENT_DETAILS,
  UNSAFE_CONTENT_REASONS,
  type UnsafeContentDetail,
} from './patch/reasons';
import { bytesEqualAt, foldAsciiCase, unsafeContentError } from './patch/shared';
import {
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  attributeField,
  bytesEqualAscii,
  bytesEqualFolded,
  createMarkup,
  localNameIs,
  localNameStart,
  NAMESPACE_DECLARATION,
  NAMESPACE_DECLARATION_PREFIX,
  nextMarkup,
  scanMarkup,
  XmlLexError,
  type XmlMarkup,
} from './patch/xml-lexer';
import { isAbsoluteUrl } from './url-target';
import { CONTENT_TYPES_PART, UNSAFE_PART_NAMES, UNSAFE_PART_PREFIXES } from './workbook-parts';

// Active package parts: a macro project, a macro, international macro or dialog sheet,
// an embedded object or package, an ActiveX control, an external link, a data
// connection or query table, an Office web add-in or its task pane, a custom ribbon
// (customUI) or attached toolbars, XML maps (which bind remote data), and any
// relationship to content outside the package.
// The byte-preserving export hands every part of a stored upload unchanged to whoever
// exports it, so the gate refuses such a part wherever it sits in the archive, found the
// way Excel finds it:
//   - by its content type: every Default and Override of the content types part;
//   - by its relationship type: every Relationship of every relationships part, chosen
//     by its content and by its name: every kept XML part, whatever its name, whose
//     root element's local name is `Relationships` in any namespace and any ASCII case
//     (a reader may ignore the namespace, and one written with a character reference is
//     the package namespace to a reader that decodes it; the walk then refuses an
//     element named `Relationship` or `Relationships` in another ASCII case, which a
//     reader that ignores case would read and the walk would skip) or, when the strict
//     lexer cannot read its markup up to its root, that holds any element a lenient
//     reader names
//     `Relationships` (a reader that folds part
//     names in Unicode takes `sheet1.xml.rel` and a long s for `sheet1.xml.rels`), and
//     every entry whose ASCII-folded name ends with .rels, whatever the part it belongs
//     to (`chart1.bin.rels` is followed like `chart1.xml.rels`). A digital signature
//     relationship (a Type that holds `/digital-signature/`: origin, signature,
//     certificate) is refused too: verifying a signature on open may fetch the
//     certificate's revocation and issuer URLs;
//   - by its target (assertSafeTarget): a relationship whose TargetMode is `External`
//     loads content from outside the package (a linked picture, an OLE link, a web
//     image), except a hyperlink of a worksheet to an http, https or mailto address,
//     which only opens when the reader clicks the cell. The TargetMode is read once per
//     relationship (relationshipTargetMode), for this rule and for the external
//     hyperlink ids alike: absent or exactly `Internal` is internal, exactly `External`
//     external, and any other value (`external`, `EXTERNAL`, `External ` with a space,
//     which a reader may still take for external) is CORRUPT_FILE `package-part`; and an internal Target
//     that names something outside the package by the rule of url-target.ts (a URI
//     with a scheme, a drive letter, a network path or a backslash, read past the tab
//     and line breaks a URL parser removes) leaves the package all the same. Whose
//     relationships part it is is decided by content, not by path: `X/_rels/Y.rels`
//     belongs to `X/Y`, and it is a worksheet's only when `X/Y` is a kept XML part whose
//     root element is `worksheet` in a SpreadsheetML main namespace (transitional or
//     strict, bound by a declaration on the root itself) and no other entry has its name
//     in another ASCII case (worksheetSource);
//   - by its name, a second line only (assertNoUnsafePartNames): a relationship Target
//     is free text, so `xl/x/a.xml` can be an external link.
// Each part is content-scanned, then walked with the strict lexer the calcChain cut
// uses (cutRootChildren), every markup of it; nothing reaches a DOM, and each walk is
// one linear pass over bytes the decompression cap already bounds. The walk of a
// worksheet's relationships part also reads which relationship ids name an external
// hyperlink, and which name one and nothing else (ExternalHyperlinkIds, each Id read
// literally: a reference, TAB, LF or CR in it is CORRUPT_FILE `package-part`): only a
// hyperlink of the worksheet may name the first, and for a hyperlink with one of the
// second the content scan takes the `location` for a URL fragment, not a formula.
// The parts this rule walks are content-scanned here and nowhere else (contentScanPlan):
// the content scan of the other kept parts (guards.ts) skips them. A relationships part
// can itself be a worksheet another relationships part belongs to (`X/Y.rels` with a
// worksheet root, and `X/_rels/Y.rels.rels`); such parts are walked last, longest name
// first, so the external hyperlink ids of each are read before it is content-scanned.

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
  'xmlmaps',
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
  'xmlmaps',
];

/** What a relationships part belongs to: a worksheet, or anything else (the package included). */
export type RelationshipsSourceKind = 'worksheet' | 'other';

/** Where a relationship's target lies, by its TargetMode (relationshipTargetMode). */
export type RelationshipTargetMode = 'internal' | 'external';

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
const ID_ATTRIBUTE = 'Id';
// The only TargetMode a relationship to content inside the package carries, when it has one.
const INTERNAL_TARGET_MODE = 'Internal';
// The only TargetMode of a relationship to content outside the package.
const EXTERNAL_TARGET_MODE = 'External';
// The ASCII-folded last Type segment of the one relationship that may point outside.
const HYPERLINK_TYPE_ENDING = 'hyperlink';
// A relationships part `X/_rels/Y.rels` belongs to the part `X/Y`.
const PATH_SEPARATOR = '/';
const RELS_FOLDER = '_rels/';
// The local name of a worksheet part's root element; its namespace is one of
// SPREADSHEET_MAIN_NAMESPACES.
const WORKSHEET_ROOT = 'worksheet';
// The local name of the root element of a relationships part (Open Packaging
// Conventions); its namespace is not compared (see the header).
const RELATIONSHIPS_ROOT = 'Relationships';
const FOLDED_RELATIONSHIPS_ROOT = foldAsciiCase(RELATIONSHIPS_ROOT);
// The local names of the elements of a relationships part, exactly and ASCII-folded.
const RELATIONSHIP_ELEMENT_NAMES: readonly string[] = [RELATIONSHIPS_ROOT, RELATIONSHIP];
const FOLDED_RELATIONSHIP_ELEMENT_NAMES: readonly string[] =
  RELATIONSHIP_ELEMENT_NAMES.map(foldAsciiCase);
// What every digital signature relationship Type holds, ASCII-folded.
const DIGITAL_SIGNATURE_TYPE_SEGMENT = '/digital-signature/';
// The ASCII-folded starts of the only targets an external worksheet hyperlink may have.
const HYPERLINK_TARGET_STARTS: readonly string[] = ['http://', 'https://', 'mailto:'];
const DEFAULT = 'Default';
const OVERRIDE = 'Override';
const CONTENT_TYPE_ATTRIBUTE = 'ContentType';

function unsafePartError(
  detail: UnsafeContentDetail,
  entry: string,
  message: string,
): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_PART, detail, entry, message);
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
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', detail, entry }`
 * when relationship Type text names an active part: its last '/' segment, trimmed and
 * ASCII-folded, equals one of UNSAFE_RELATIONSHIP_TYPE_ENDINGS (`packageOther` does not
 * end in `package`; detail `active-relationship`), or, ASCII-folded, it holds
 * `/digital-signature/` (a signature origin, signature or certificate: see the header;
 * detail `digital-signature`). `entry` is the relationships part the Type was read from.
 */
export function assertSafeRelationshipType(type: string, entry: string): void {
  if (foldAsciiCase(type).includes(DIGITAL_SIGNATURE_TYPE_SEGMENT)) {
    throw unsafePartError(
      UNSAFE_CONTENT_DETAILS.DIGITAL_SIGNATURE,
      entry,
      'Workbook declares a digital signature',
    );
  }
  if (!UNSAFE_ENDINGS.has(foldedLastSegment(type.trim()))) return;
  throw unsafePartError(
    UNSAFE_CONTENT_DETAILS.ACTIVE_RELATIONSHIP,
    entry,
    'Workbook declares a relationship to an active part',
  );
}

/**
 * The part relationships part `entry` belongs to: `X/Y` for `X/_rels/Y.rels` (X may be
 * empty, Y may not). Null for any other name, the root relationships part `_rels/.rels`
 * included (it belongs to the package).
 */
function relationshipsSource(entry: string): string | null {
  if (!entry.endsWith(RELS_SUFFIX)) return null;
  const fileStart = entry.lastIndexOf(PATH_SEPARATOR) + 1;
  const folderStart = fileStart - RELS_FOLDER.length;
  const source = entry.slice(fileStart, entry.length - RELS_SUFFIX.length);
  const inRelsFolder =
    folderStart >= 0 &&
    entry.startsWith(RELS_FOLDER, folderStart) &&
    (folderStart === 0 || entry.charAt(folderStart - 1) === PATH_SEPARATOR);
  if (!inRelsFolder || source.length === 0) return null;
  return entry.slice(0, folderStart) + source;
}

/**
 * CORRUPT_FILE `package-part` for relationships part `entry` when the element scanned
 * into `markup` has a local name that is `Relationship` or `Relationships` only once
 * ASCII-folded (`relationship`, `RELATIONSHIPS`): the walk matches those names exactly,
 * and a reader that compares element names ignoring case would read an element the
 * walk skipped.
 */
export function assertRelationshipElementSpelling(
  bytes: Uint8Array,
  markup: XmlMarkup,
  entry: string,
): void {
  const start = localNameStart(bytes, markup);
  const end = markup.nameEnd;
  const folded = FOLDED_RELATIONSHIP_ELEMENT_NAMES.some((name) =>
    bytesEqualFolded(bytes, start, end, name),
  );
  if (!folded) return;
  if (RELATIONSHIP_ELEMENT_NAMES.some((name) => bytesEqualAscii(bytes, start, end, name))) return;
  throw packagePartError(entry, 'has a relationships element named in another ASCII case');
}

/** The RootCheck of the walk of relationships part `entry`: assertRelationshipElementSpelling. */
export function relationshipsRootCheck(bytes: Uint8Array, entry: string): RootCheck {
  return (markup) => assertRelationshipElementSpelling(bytes, markup, entry);
}

/** What the root element of an XML part is to rootElementMatch: the one asked for, another (or none), or unknown. */
type RootMatch = 'match' | 'other' | 'unreadable';

/** Whether the root start tag scanned into `markup` is the one rootElementMatch looks for. */
type RootMatcher = (markup: XmlMarkup, attributes: readonly number[]) => boolean;

/**
 * Whether attribute name bytes [start, end) declare the prefix of `prefixLength` bytes
 * at `prefixStart`: `xmlns` for no prefix, `xmlns:` and those bytes otherwise.
 */
function declaresPrefix(
  bytes: Uint8Array,
  start: number,
  end: number,
  prefixStart: number,
  prefixLength: number,
): boolean {
  if (prefixLength === 0) return bytesEqualAscii(bytes, start, end, NAMESPACE_DECLARATION);
  const prefixEnd = start + NAMESPACE_DECLARATION_PREFIX.length;
  return (
    end - prefixEnd === prefixLength &&
    bytesEqualAscii(bytes, start, prefixEnd, NAMESPACE_DECLARATION_PREFIX) &&
    bytesEqualAt(bytes, prefixEnd, bytes, prefixStart, prefixLength)
  );
}

/**
 * Whether the start tag scanned into `markup`, a root element, binds its own prefix (the
 * default namespace without one) to one of `namespaces` by declarations on itself, the
 * only ones in scope at the root: at least one, and each names one of them, compared as
 * raw bytes (a value written with a reference never matches).
 */
function bindsOwnNamespace(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  namespaces: readonly string[],
): boolean {
  const localStart = localNameStart(bytes, markup);
  const prefixLength = localStart === markup.nameStart ? 0 : localStart - 1 - markup.nameStart;
  let bound = false;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (!declaresPrefix(bytes, nameStart, nameEnd, markup.nameStart, prefixLength)) continue;
    const valueStart = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
    const valueEnd = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
    if (!namespaces.some((namespace) => bytesEqualAscii(bytes, valueStart, valueEnd, namespace))) {
      return false;
    }
    bound = true;
  }
  return bound;
}

/**
 * Whether the root element of XML part `bytes`, its first element past any declaration,
 * comment or processing instruction, is the one `matches` looks for: 'match' when it
 * is, 'unreadable' when the strict lexer refuses the markup up to and including the
 * root's start tag, 'other' for any other root, or none. Reads up to the root's start
 * tag only.
 */
function rootElementMatch(bytes: Uint8Array, matches: RootMatcher): RootMatch {
  const markup = createMarkup();
  const attributes: number[] = [];
  try {
    for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
      scanMarkup(bytes, at, markup, attributes);
      if (markup.kind === 'start' || markup.kind === 'empty') {
        return matches(markup, attributes) ? 'match' : 'other';
      }
      if (markup.kind === 'end') return 'other';
    }
  } catch (error) {
    if (error instanceof XmlLexError) return 'unreadable';
    throw error;
  }
  return 'other';
}

/**
 * Whether the root element of XML part `bytes` is `worksheet` in a SpreadsheetML main
 * namespace (bindsOwnNamespace); false when the strict lexer cannot read up to it.
 */
function hasWorksheetRoot(bytes: Uint8Array): boolean {
  const isWorksheet: RootMatcher = (markup, attributes) =>
    localNameIs(bytes, markup, WORKSHEET_ROOT) &&
    bindsOwnNamespace(bytes, markup, attributes, SPREADSHEET_MAIN_NAMESPACES);
  return rootElementMatch(bytes, isWorksheet) === 'match';
}

/**
 * Whether kept XML entry `name`, of content `bytes`, is a relationships part the gate
 * walks (see the header): its name says so (isRelationshipsPartName), or the local name
 * of its root element is `Relationships` in any ASCII case (the walk then refuses any
 * other spelling: assertRelationshipElementSpelling), whatever its namespace, or the
 * strict lexer cannot read up to its root and a lenient reader finds an element named so
 * (opensLooseElement).
 */
function isRelationshipsPart(name: string, bytes: Uint8Array): boolean {
  if (isRelationshipsPartName(name)) return true;
  const isRelationships: RootMatcher = (markup) =>
    bytesEqualFolded(
      bytes,
      localNameStart(bytes, markup),
      markup.nameEnd,
      FOLDED_RELATIONSHIPS_ROOT,
    );
  const root = rootElementMatch(bytes, isRelationships);
  if (root === 'unreadable') return opensLooseElement(bytes, RELATIONSHIPS_ROOT);
  return root === 'match';
}

/**
 * The worksheet relationships part `entry` belongs to (see the header): its source part
 * when that is a kept XML part (`contents`) whose root is a worksheet and no other
 * entry's ASCII-folded name (`foldedNameCounts`) is the source's; null otherwise (the
 * part belongs to something else).
 */
function worksheetSource(
  entry: string,
  contents: ReadonlyMap<string, Uint8Array>,
  foldedNameCounts: ReadonlyMap<string, number>,
): string | null {
  const source = relationshipsSource(entry);
  if (source === null || foldedNameCounts.get(foldAsciiCase(source)) !== 1) return null;
  const bytes = contents.get(source);
  return bytes !== undefined && hasWorksheetRoot(bytes) ? source : null;
}

/** Whether an external relationship of `type` in a relationships part of `source` to `target` is a worksheet hyperlink to a web or mail address. */
function isWorksheetWebHyperlink(
  type: string | null,
  source: RelationshipsSourceKind,
  target: string | null,
): boolean {
  if (type === null || target === null || source !== 'worksheet') return false;
  if (foldedLastSegment(type) !== HYPERLINK_TYPE_ENDING) return false;
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
 * The TargetMode of the Relationship scanned into `markup`, read once for every rule that
 * needs it (see the header): 'internal' without one or for exactly `Internal`,
 * 'external' for exactly `External`. CORRUPT_FILE `package-part` for relationships part
 * `entry` for any other value (`external`, `EXTERNAL`, `External ` with a space), and for
 * a TargetMode that repeats or holds a reference, a TAB, an LF or a CR
 * (literalAttributeText).
 */
export function relationshipTargetMode(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  entry: string,
): RelationshipTargetMode {
  const mode = literalAttributeText(bytes, markup, attributes, TARGET_MODE_ATTRIBUTE, entry);
  if (mode === null || mode === INTERNAL_TARGET_MODE) return 'internal';
  if (mode === EXTERNAL_TARGET_MODE) return 'external';
  throw packagePartError(entry, 'has a TargetMode other than Internal or External');
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', detail, entry }`
 * when the Relationship scanned into `markup`, of `type` (null without one) and
 * TargetMode `mode` (relationshipTargetMode) and read from relationships part `entry`,
 * which belongs to a part of `source` kind (worksheetSource), reaches outside the
 * package:
 *   - it is external, unless its type's last '/' segment, ASCII-folded, is exactly
 *     `hyperlink`, `source` is `worksheet` and its Target, ASCII-folded, starts with
 *     `http://`, `https://` or `mailto:` (detail `external-target`);
 *   - or it is internal and its decoded Target names something outside the package
 *     (isAbsoluteUrl of url-target.ts: a URI scheme, a drive letter, `//` or a
 *     backslash, read past the controls, spaces, tab and line breaks a URL parser drops;
 *     detail `absolute-target`).
 * CORRUPT_FILE `package-part` when the Target repeats or holds a reference the walk
 * cannot decode.
 */
export function assertSafeTarget(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  type: string | null,
  mode: RelationshipTargetMode,
  entry: string,
  source: RelationshipsSourceKind,
): void {
  const target = relationshipTarget(bytes, markup, attributes, entry);
  switch (mode) {
    case 'external':
      if (isWorksheetWebHyperlink(type, source, target)) return;
      throw unsafePartError(
        UNSAFE_CONTENT_DETAILS.EXTERNAL_TARGET,
        entry,
        'Workbook declares a relationship to external content',
      );
    case 'internal':
      if (target === null || !isAbsoluteUrl(target)) return;
      throw unsafePartError(
        UNSAFE_CONTENT_DETAILS.ABSOLUTE_TARGET,
        entry,
        'Workbook declares an internal relationship that leaves the package',
      );
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled TargetMode: ${String(_exhaustive)}`);
    }
  }
}

function isUnsafeContentType(contentType: string): boolean {
  const folded = foldAsciiCase(contentType);
  return UNSAFE_CONTENT_TYPE_MARKERS.some((marker) => folded.includes(marker));
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason: 'unsafe-part', detail, entry }`
 * (detail `active-part-name`) for an entry whose ASCII-folded name is one of
 * UNSAFE_PART_NAMES or starts with one of UNSAFE_PART_PREFIXES. Reads names only;
 * nothing is inflated.
 */
export function assertNoUnsafePartNames(names: Iterable<string>): void {
  for (const name of names) {
    const folded = foldAsciiCase(name);
    const unsafe =
      UNSAFE_PART_NAMES.includes(folded) ||
      UNSAFE_PART_PREFIXES.some((prefix) => folded.startsWith(prefix));
    if (unsafe) {
      throw unsafePartError(
        UNSAFE_CONTENT_DETAILS.ACTIVE_PART_NAME,
        name,
        'Workbook holds a macro, embedded or external link part',
      );
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

/**
 * Refuses a Default or Override whose ContentType holds an unsafe marker. Records every
 * ContentType it reads in `census`, when given.
 */
function contentTypeSelector(
  bytes: Uint8Array,
  census: PackageCensusCollector | undefined,
): ChildSelector {
  return (markup, attributes) => {
    if (!localNameIs(bytes, markup, DEFAULT) && !localNameIs(bytes, markup, OVERRIDE)) return false;
    const contentType = literalAttributeText(
      bytes,
      markup,
      attributes,
      CONTENT_TYPE_ATTRIBUTE,
      CONTENT_TYPES_PART,
    );
    census?.addContentType(contentType);
    if (contentType === null) return false;
    if (isUnsafeContentType(contentType)) {
      throw unsafePartError(
        UNSAFE_CONTENT_DETAILS.ACTIVE_CONTENT_TYPE,
        CONTENT_TYPES_PART,
        'Workbook declares the content type of an active part',
      );
    }
    return false;
  };
}

/**
 * The Id of the Relationship scanned into `markup`, null without one. Read literally
 * (literalAttributeText), so the content scan compares it with the ids the worksheet
 * names: CORRUPT_FILE `package-part` for `entry` when it repeats or holds a reference, a
 * TAB, an LF or a CR.
 */
function relationshipId(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  entry: string,
): string | null {
  return literalAttributeText(bytes, markup, attributes, ID_ATTRIBUTE, entry);
}

/**
 * Whether a Relationship of `type` and TargetMode `mode` (relationshipTargetMode) is an
 * external hyperlink: its type's last '/' segment, ASCII-folded, is exactly `hyperlink`
 * and it is external.
 */
function isExternalHyperlink(type: string | null, mode: RelationshipTargetMode): boolean {
  if (type === null || foldedLastSegment(type) !== HYPERLINK_TYPE_ENDING) return false;
  return mode === 'external';
}

/** What the walk of a worksheet's relationships part records of each relationship Id. */
interface HyperlinkRecord {
  /** Per Id, whether every Relationship of it so far is an external hyperlink. */
  readonly onlyExternal: Map<string, boolean>;
  /** The Ids at least one Relationship of which is an external hyperlink. */
  readonly external: Set<string>;
}

/**
 * Refuses a Relationship whose Type names an active part, or whose target reaches outside
 * the package. With `hyperlinks` (a worksheet's relationships part), records for each Id
 * whether every Relationship of that Id is an external hyperlink, and whether one is.
 * Records every Type it reads in `census`, when given.
 */
function relationshipSelector(
  bytes: Uint8Array,
  entry: string,
  source: RelationshipsSourceKind,
  hyperlinks: HyperlinkRecord | null,
  census: PackageCensusCollector | undefined,
): ChildSelector {
  return (markup, attributes) => {
    assertRelationshipElementSpelling(bytes, markup, entry);
    if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
    const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, entry);
    census?.addRelationshipType(type);
    if (type !== null) assertSafeRelationshipType(type, entry);
    const mode = relationshipTargetMode(bytes, markup, attributes, entry);
    assertSafeTarget(bytes, markup, attributes, type, mode, entry, source);
    if (hyperlinks === null) return false;
    const id = relationshipId(bytes, markup, attributes, entry);
    if (id === null) return false;
    const external = isExternalHyperlink(type, mode);
    hyperlinks.onlyExternal.set(id, external && (hyperlinks.onlyExternal.get(id) ?? true));
    if (external) hyperlinks.external.add(id);
    return false;
  };
}

/** The ids `hyperlinks` (relationshipSelector) found to be external hyperlinks, only or among others. */
function worksheetHyperlinkIds(hyperlinks: HyperlinkRecord): WorksheetHyperlinkIds {
  const onlyExternal = new Set<string>();
  for (const [id, external] of hyperlinks.onlyExternal) {
    if (external) onlyExternal.add(id);
  }
  return { onlyExternal, external: hyperlinks.external };
}

/**
 * Which step of the gate content-scans each kept XML part of `contents`, the one content
 * scan it gets (ContentScanStep): 'package-walk' for the parts assertNoUnsafePackageParts
 * walks, the content types part and every relationships part (isRelationshipsPart, by
 * its name or by its root element), 'content-scan' for every other one. The root
 * relationships part is not among `contents`: the root relationships rule of guards.ts
 * scans it.
 */
export function contentScanPlan(contents: ReadonlyMap<string, Uint8Array>): ContentScanPlan {
  const plan = new Map<string, ContentScanStep>();
  for (const [name, bytes] of contents) {
    const walked = name === CONTENT_TYPES_PART || isRelationshipsPart(name, bytes);
    plan.set(name, walked ? 'package-walk' : 'content-scan');
  }
  return plan;
}

/** A relationships part the package walk reads, and the worksheet it belongs to (worksheetSource), or null. */
interface RelationshipsWalk {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly worksheet: string | null;
}

/**
 * The relationships parts of `contents` the package walk reads (the parts `plan` gives
 * it, and the content types part when its root is a relationships root), each with the
 * worksheet it belongs to, in walk order (see the header): zip order, then those that are
 * themselves a worksheet another of them belongs to, longest name first.
 */
function relationshipsWalks(
  contents: ReadonlyMap<string, Uint8Array>,
  plan: ContentScanPlan,
  foldedNameCounts: ReadonlyMap<string, number>,
): RelationshipsWalk[] {
  const walks: RelationshipsWalk[] = [];
  for (const [name, bytes] of contents) {
    const relationships =
      name === CONTENT_TYPES_PART
        ? isRelationshipsPart(name, bytes)
        : plan.get(name) === 'package-walk';
    if (!relationships) continue;
    walks.push({ name, bytes, worksheet: worksheetSource(name, contents, foldedNameCounts) });
  }
  const worksheets = new Set(walks.map((walk) => walk.worksheet));
  const isWorksheet = (walk: RelationshipsWalk): boolean => worksheets.has(walk.name);
  return [
    ...walks.filter((walk) => !isWorksheet(walk)),
    ...walks.filter(isWorksheet).sort((a, b) => b.name.length - a.name.length),
  ];
}

/**
 * The type rule of the gate, on the name of every entry and the content of the entries
 * the gate keeps: no entry spelled in another ASCII case than a part the rule walks
 * (assertWalkedSpelling), no Default or Override of the content types part whose
 * ContentType holds a marker, and no Relationship of a kept relationships part (every
 * kept entry named `.rels` or whose root element's local name is Relationships:
 * isRelationshipsPart) whose Type ends in an unsafe segment or names a digital
 * signature, or whose target reaches outside the package (assertSafeTarget, told what
 * the part belongs to by worksheetSource). Each part it walks is content-scanned first
 * (assertSafeXmlPart, with the external hyperlink ids its own relationships part gives
 * it and `budget`), once; `plan` (contentScanPlan) names them. Returns, per worksheet
 * that has a relationships part, the ids that part gives an external hyperlink, and those
 * it gives one and nothing else (ExternalHyperlinkIds, for the content scan's hyperlink
 * rules).
 *
 * Throws SpreadsheetFileError: UNSAFE_CONTENT `{ reason: 'unsafe-part', detail, entry }`
 * for an unsafe declaration (an active content type: detail `active-content-type`);
 * UNSAFE_CONTENT when the content scan refuses a part it walks;
 * PAYLOAD_TOO_LARGE `formula-scan-budget` past the formula scan budget; CORRUPT_FILE
 * `{ reason: 'package-part', entry }` for a misspelled entry, a part the
 * walk cannot read whole (not UTF-8, a declaration of another encoding, no root element,
 * an element below a direct child of the root), markup outside the lexer's strict
 * subset, a broken element structure, an element of a relationships part whose local
 * name is `Relationship` or `Relationships` only once ASCII-folded
 * (assertRelationshipElementSpelling), a repeated ContentType, Type, Target or
 * TargetMode, a ContentType, Type or TargetMode that holds a reference or a line break
 * (it could not be compared byte for byte), a TargetMode other than `Internal` or
 * `External` (relationshipTargetMode), a Target the walk cannot decode, or, in a
 * worksheet's relationships part, an Id that holds a reference or a line break.
 *
 * With `census` (the package census, package-census.ts), it records every ContentType of
 * the content types part and every Relationship Type of every part it walks, where it
 * reads them; the root relationships part is not walked here (guards.ts records it).
 */
export function assertNoUnsafePackageParts(
  names: Iterable<string>,
  contents: ReadonlyMap<string, Uint8Array>,
  plan: ContentScanPlan = contentScanPlan(contents),
  budget: FormulaScanBudget = createFormulaScanBudget(),
  census?: PackageCensusCollector,
): ExternalHyperlinkIds {
  const foldedNameCounts = new Map<string, number>();
  for (const name of names) {
    assertWalkedSpelling(name);
    const folded = foldAsciiCase(name);
    foldedNameCounts.set(folded, (foldedNameCounts.get(folded) ?? 0) + 1);
  }
  const contentTypes = contents.get(CONTENT_TYPES_PART);
  if (contentTypes !== undefined) {
    assertSafeXmlPart(CONTENT_TYPES_PART, contentTypes, NO_HYPERLINK_IDS, budget);
    cutRootChildren(contentTypes, CONTENT_TYPES_PART, contentTypeSelector(contentTypes, census));
  }
  const externalHyperlinks = new Map<string, WorksheetHyperlinkIds>();
  for (const { name, bytes, worksheet } of relationshipsWalks(contents, plan, foldedNameCounts)) {
    // The content types part was content-scanned with its own walk.
    if (name !== CONTENT_TYPES_PART) {
      assertSafeXmlPart(name, bytes, externalHyperlinks.get(name) ?? NO_HYPERLINK_IDS, budget);
    }
    const checkRoot = relationshipsRootCheck(bytes, name);
    if (worksheet === null) {
      cutRootChildren(
        bytes,
        name,
        relationshipSelector(bytes, name, 'other', null, census),
        checkRoot,
      );
      continue;
    }
    const hyperlinks: HyperlinkRecord = { onlyExternal: new Map(), external: new Set() };
    cutRootChildren(
      bytes,
      name,
      relationshipSelector(bytes, name, 'worksheet', hyperlinks, census),
      checkRoot,
    );
    externalHyperlinks.set(worksheet, worksheetHyperlinkIds(hyperlinks));
  }
  return externalHyperlinks;
}
