import { isUtf8 } from 'node:buffer';

import { strFromU8 } from 'fflate';
import { MAX_XMLNS_DECLARATIONS_PER_PART } from './constants';
import { SpreadsheetFileError } from './errors';
import { formulaTextRefusal, type QuotedSection } from './formula-scan';
import { UNSAFE_CONTENT_REASONS, ZIP_REJECT_REASONS } from './patch/reasons';
import { bytesEqualAt, foldAsciiCase, metaEntryName, unsafeContentError } from './patch/shared';
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
  isNameByte,
  isXmlDeclaration,
  isXmlSpace,
  localNameStart,
  NAME_DECODER,
  nextMarkup,
  QUESTION,
  scanMarkup,
  SPACE,
  TAG_OPEN,
  XmlLexError,
  type XmlMarkup,
} from './patch/xml-lexer';
import {
  createUrlStartReader,
  isAbsoluteUrl,
  readUrlStart,
  type UrlStartReader,
} from './url-target';

// The entries the grid reader may open: exactly the names ending in `.xml` or
// `.xml.rels` (the rule read-excel-file's filterZipArchiveEntry used, kept so the same
// parts are read). The gate scans more than these (see "Which entries are XML").
const XML_PART_SUFFIXES: readonly string[] = ['.xml', '.xml.rels'];

// A DOCTYPE or ENTITY declaration can define entities that expand exponentially
// (billion laughs) or resolve external resources (XXE). A genuine xlsx part never
// carries a DTD.
const DTD_DECLARATION = /<!(?:DOCTYPE|ENTITY)/i;

// An `&` that does not start one of the five predefined references or a numeric
// character reference. Linear: the lookahead only runs at `&` positions and its digit
// runs stop at the next non-digit, so no `[\s\S]*?` span is ever re-scanned.
// A bare `&` inside a CDATA section is rejected too, on purpose: Excel never writes
// CDATA, so this only fails closed on hand-made files.
const UNKNOWN_ENTITY_REFERENCE = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/;

// Which entries are XML. The byte-preserving export hands every entry of a stored upload
// on unchanged, and an opener finds a part by its relationship, not by its name, so the
// gate chooses the parts it scans by their content: an entry is XML when, after an
// optional UTF-8 byte order mark, its first byte that is not XML white space is '<'.
// An entry that starts with a UTF-16 or UTF-32 byte order mark or with `<?xm` in EBCDIC
// (the signature by which an XML reader detects an EBCDIC declaration), or whose first
// '<' has a U+0000 byte right before or after it (UTF-16 or UTF-32 text without a
// mark), is XML the scans cannot read: CORRUPT_FILE `part-encoding`. So is an entry named `.xml`,
// `.rels` or `.vml` (ASCII case folded) whose content is not XML. The decision reads the
// first bytes only, chunk by chunk (EntryContentSniff), so the stream keeps nothing of
// an image or another binary entry.
const XML_CONTENT_NAME_SUFFIXES: readonly string[] = ['.xml', '.rels', '.vml'];
const UTF8_BYTE_ORDER_MARK: readonly number[] = [0xef, 0xbb, 0xbf];
// UTF-16 big and little endian (the little-endian one also opens UTF-32 little endian),
// and UTF-32 big endian.
const OTHER_BYTE_ORDER_MARKS: readonly (readonly number[])[] = [
  [0xfe, 0xff],
  [0xff, 0xfe],
  [0x00, 0x00, 0xfe, 0xff],
];
// `<?xm` in EBCDIC: the first bytes of an XML declaration written in it.
const EBCDIC_DECLARATION_START: readonly number[] = [0x4c, 0x6f, 0xa7, 0x94];
// The first bytes held until the byte order mark is read: the longest mark.
const BYTE_ORDER_MARK_LENGTH = 4;
const NO_BYTE = -1;

// Formula fields (spec section 2.1 item 7). In every XML part, whatever its root element
// and path, the gate reads every field Excel evaluates: the text of the
// FORMULA_ELEMENT_NAMES elements, the value of the FORMULA_ATTRIBUTE_NAMES attributes,
// and the value of the ELEMENT_FORMULA_ATTRIBUTE_NAMES attributes on their one element
// (a conditional format value object's `val`, a hyperlink's `location`, a camera tool's
// `cellRange`), local names compared ignoring their prefix and ASCII case (so a reader
// that ignores case finds no field the gate skipped). A hyperlink's `location` is no
// field only when the hyperlink leads to an external hyperlink of its part: it has a
// relationship id (an `id` attribute whose prefix is bound to RELATIONSHIPS_NAMESPACE
// where it stands), and every one it has names a relationship of the part's own
// relationships part whose type ends in `hyperlink` and whose TargetMode is `External`
// (ExternalHyperlinkIds, read by unsafe-parts.ts by the worksheet source rule). Then the
// hyperlink leads to the relationship's URL and Excel keeps that URL's #fragment in
// `location` (https://site/page#part: Target https://site/page, location `part`), which
// is no formula. No other element may name an external hyperlink of its part: an
// element whose local name is not `hyperlink` with a prefixed attribute whose local
// name is `id` (ASCII case ignored, whatever namespace its prefix is bound to) and whose
// decoded value names a relationship of the part's relationships part that is an
// external hyperlink (a worksheet `<picture r:id>` would load its background from the
// web) is refused, UNSAFE_CONTENT `unsafe-part`. Each field is decoded (the five
// predefined references and every character reference replaced) and must pass
// formula-scan.ts; in the `formula` attribute of a PIVOT_FORMULA_ELEMENT_NAMES element
// (a pivot calculated field or item) a quoted section is a field name, not a sheet name.
// An element field must hold text only, up to its own end tag: a comment, CDATA section,
// processing instruction or child element could split a name or hide it from a text
// scan. The one exception is the shape Excel 2010+ writes for a data validation list or
// a conditional format that reaches another sheet (`<x14:formula1><xm:f>Lists!$A$2:$A$20
// </xm:f></x14:formula1>`): exactly one child element whose local name is `f`, holding
// text only, with nothing but white space around it; that inner text is the field. An
// empty field passes.
// An Office Math fraction is also named `f` (an equation in a text box writes
// `<m:f><m:fPr/>...</m:f>`), so an element in the OMML_NAMESPACE is not a formula field.
// The walk keeps the namespace declarations in scope (NamespaceScopes): a prefix is held
// only while a declaration of it is in scope, and its key is dropped with its last
// binding, so the prefixes held at once never outnumber the declarations in scope, which
// MAX_XMLNS_DECLARATIONS_PER_PART caps. It keeps the qualified name of every open
// element (two offsets into the
// part) up to MAX_TRACKED_ELEMENT_DEPTH open elements, and every end tag must name the
// innermost open element, byte for byte. An end tag that names another element (a
// lenient reader may close an ancestor there), an end tag with no element open, or an
// element opened past that depth leaves the walk unable to follow the nesting: from
// there on to the end of the part no binding counts, so every `f` is a field and every
// hyperlink `location` a formula. A part that has more than
// MAX_XMLNS_DECLARATIONS_PER_PART declarations in scope at once (those of the open
// elements and of the element being read; once the walk cannot follow the nesting,
// every declaration read from there on stays counted) is refused with the error the
// reader parts get for more declarations in all (tooManyNamespaceDeclarations); the
// reader parts keep that cap on every declaration they hold (guards.ts).
// A macro assignment needs code the gate never accepts, so a non-empty
// MACRO_ATTRIBUTE_NAMES attribute or FmlaMacro element is refused (Excel writes
// `macro=""` on every shape), and an element of ACTIVE_ELEMENT_NAMES (an embedded
// object, a control, a web publishing item, a `script` of SVG or HTML) is refused
// wherever it stands. So is a
// SCRIPT_ELEMENT_NAMES element (a VML control's script) that holds anything but white
// space.
// URLs. A URL attribute (`src`, or any local name that ends with URL_ATTRIBUTE_SUFFIX
// `href`, ASCII case ignored, any prefix: VML's v:imagedata@src, @o:href, @o:althref,
// v:fill@src, a shape's href, SVG's xlink:href)
// or a BASE_URL_ATTRIBUTE_NAMES attribute (`base`: xml:base) names a resource outside
// the relationships, so its decoded value must be relative by the rule of url-target.ts
// (no URI scheme, drive letter, leading '//' or backslash). The one exception is a URL
// attribute whose ASCII-folded value starts with DATA_IMAGE_URL_START (an image the
// value holds, which fetches nothing); any other `data:` is refused. A style (the value
// of a STYLE_NAMES attribute, and the text and CDATA content of a STYLE_NAMES element up
// to its own end tag, or to the end of the part when the walk cannot follow the nesting
// there, its descendants' included but for the formula, macro and script fields scanned
// on their own) must load nothing: it may hold no
// `@import`, no backslash (a CSS escape can spell either name) and no `url(` whose
// target, past CSS white space and an optional quote, is absolute by that rule or
// starts a comment. The text of a style element is read piece by piece (CssScan), in
// constant memory: nothing of it is kept but how much of `@import` and `url(` its last
// code units spell and where the last `url(` target stands. Any other attribute value,
// whatever its name, is CSS to an SVG renderer (`fill`, `filter`, `clip-path`, `mask`,
// `cursor`, `marker-*`), so it may hold no `url(` whose target is absolute or starts a
// comment either, nor a backslash from its first `url(` on (a CSS escape can spell a
// scheme); `url(#local)` passes. A STYLESHEET_INSTRUCTION_NAMES processing instruction
// (`xml-stylesheet`) is refused wherever it stands. Each refusal is UNSAFE_CONTENT
// `unsafe-part`.
// Where the strict lexer refuses markup that a lenient or a non-ASCII reading accepts,
// the walk cannot tell where the fields are from there on, so the part is refused when
// anything after that point could open a field, macro, script or active element or an
// element with a field attribute of its own, or name a field, macro, URL, base or style
// attribute, a style element or a stylesheet instruction, or when it holds a `url(`
// (ASCII case ignored) or a character reference (which could spell one), or, in a part
// with external hyperlinks, a prefixed `id` name; inside a style element the
// part is refused at once.
// Every pass is linear in the part; the formula fields are read without a regular
// expression (formula-scan.ts).
const FORMULA_ELEMENT_NAMES: readonly string[] = [
  'f',
  'formula',
  'formula1',
  'formula2',
  'oldFormula',
  'calculatedColumnFormula',
  'totalsRowFormula',
  'definedName',
  'FmlaLink',
  'FmlaRange',
  'FmlaTxbx',
  'FmlaPict',
  'FmlaGroup',
];
const FORMULA_ATTRIBUTE_NAMES: readonly string[] = [
  'formula',
  'textlink',
  'link',
  'fmlaLink',
  'fmlaRange',
  'fmlaTxbx',
  'fmlaGroup',
  'fmlaPict',
];
// Attributes that are formula fields on one element only: [element, attribute].
const ELEMENT_FORMULA_ATTRIBUTE_NAMES: readonly (readonly [element: string, attribute: string])[] =
  [
    ['cfvo', 'val'],
    ['hyperlink', 'location'],
    ['cameraTool', 'cellRange'],
  ];
// Elements whose `formula` attribute names pivot fields in its quoted sections.
const PIVOT_FORMULA_ELEMENT_NAMES: readonly string[] = ['cacheField', 'calculatedItem'];
const PIVOT_FORMULA_ATTRIBUTE_NAME = 'formula';
// The local name of the one child element a formula field may hold (see the header).
const INNER_FORMULA_ELEMENT_NAME = 'f';
// Elements whose field attribute is a URL fragment when they carry a relationship id.
const URL_FRAGMENT_ELEMENT_NAMES: readonly string[] = ['hyperlink'];
// The local name of a relationship id attribute (`r:id`), compared exactly.
const RELATIONSHIP_ID_ATTRIBUTE = 'id';
const MACRO_ATTRIBUTE_NAMES: readonly string[] = ['macro', 'fmlaMacro'];
const MACRO_ELEMENT_NAMES: readonly string[] = ['FmlaMacro'];
const SCRIPT_ELEMENT_NAMES: readonly string[] = ['ScriptText'];
const URL_ATTRIBUTE_NAMES: readonly string[] = ['src'];
// Every attribute whose ASCII-folded local name ends with this is a URL attribute too.
const URL_ATTRIBUTE_SUFFIX = 'href';
const BASE_URL_ATTRIBUTE_NAMES: readonly string[] = ['base'];
// The ASCII-folded start of the one data: URI a URL attribute may hold (see the header).
const DATA_IMAGE_URL_START = 'data:image/';
// Attributes and elements whose value or text is CSS.
const STYLE_NAMES: readonly string[] = ['style'];
// Processing instruction targets that load a resource.
const STYLESHEET_INSTRUCTION_NAMES: readonly string[] = ['xml-stylesheet'];
const ACTIVE_ELEMENT_NAMES: readonly string[] = [
  'oleObject',
  'oleObjects',
  'control',
  'controls',
  'webPublishItem',
  'webPublishObject',
  'script',
];
// A namespace declaration is not an attribute: `xmlns`, or the `xmlns` prefix.
const NAMESPACE_DECLARATION = 'xmlns';
const NAMESPACE_DECLARATION_PREFIX = 'xmlns:';
// Office Math Markup Language: its elements are never formula fields (see the header).
const OMML_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
// The namespace of a relationship id (see the header).
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// The key of the default namespace among the prefixes of NamespaceScopes.
const DEFAULT_NAMESPACE_KEY = '';
/** The most open elements the walk follows the nesting of (see the header). */
export const MAX_TRACKED_ELEMENT_DEPTH = 512;

/** The relationship ids a worksheet's own relationships part gives an external hyperlink (see the header). */
export interface WorksheetHyperlinkIds {
  /** The ids it gives an external hyperlink and nothing else: a hyperlink with one keeps a URL fragment in its `location`. */
  readonly onlyExternal: ReadonlySet<string>;
  /** The ids it gives an external hyperlink, among others or not: no element but a hyperlink may name one. */
  readonly external: ReadonlySet<string>;
}

/**
 * Per worksheet part name, the relationship ids its own relationships part gives an
 * external hyperlink (assertNoUnsafePackageParts reads them; see the header).
 */
export type ExternalHyperlinkIds = ReadonlyMap<string, WorksheetHyperlinkIds>;

const NO_EXTERNAL_HYPERLINKS: ExternalHyperlinkIds = new Map();
const NO_HYPERLINK_IDS: WorksheetHyperlinkIds = { onlyExternal: new Set(), external: new Set() };

/** Lower-case ASCII names, by length. */
type NameSet = ReadonlyMap<number, readonly string[]>;

/** The namespaces the walk tells apart; every other one is 'other'. */
type KnownNamespace = 'omml' | 'relationships' | 'other';

const KNOWN_NAMESPACES: readonly (readonly [uri: string, namespace: KnownNamespace])[] = [
  [OMML_NAMESPACE, 'omml'],
  [RELATIONSHIPS_NAMESPACE, 'relationships'],
];

/** One namespace binding: the level of the element that declared it and the namespace it names. */
interface NamespaceBinding {
  readonly level: number;
  namespace: KnownNamespace;
}

/** An open element that declares namespaces. */
interface DeclaringElement {
  /** How many elements are open around it. */
  readonly level: number;
  /** The prefixes it bound (DEFAULT_NAMESPACE_KEY for the default namespace). */
  readonly prefixes: readonly string[];
  /** How many namespace declarations it holds. */
  readonly declarations: number;
}

/**
 * The namespace declarations in scope while one part is walked, in memory bounded by
 * MAX_TRACKED_ELEMENT_DEPTH and MAX_XMLNS_DECLARATIONS_PER_PART (see the header). A
 * declaration is compared byte for byte: one written with a reference names another
 * namespace. A prefix declared twice on one element names a known namespace only when
 * both declarations name it.
 */
interface NamespaceScopes {
  /** Per prefix (DEFAULT_NAMESPACE_KEY for the default namespace), its bindings, innermost last. */
  readonly bindings: Map<string, NamespaceBinding[]>;
  /** The open elements that declare namespaces, innermost last. */
  readonly declaring: DeclaringElement[];
  /** The qualified name of each open element, outermost first: its nameStart and nameEnd offsets. */
  readonly openNames: number[];
  /** How many elements are open. */
  depth: number;
  /** The namespace declarations in scope (see the header). */
  declarationsInScope: number;
  /** The walk lost the nesting of the part: no binding counts. */
  broken: boolean;
}

// The level of StyleText while the walk is inside no style element.
const OUTSIDE_STYLE = -1;

/** Where a CssScan stands after the `url(` it read last. */
type CssUrlPhase =
  // No `url(` target is being read.
  | 'none'
  // Past `url(`: CSS white space is skipped.
  | 'space'
  // Past `url(` and white space, a '/': a '*' next opens a comment.
  | 'slash'
  // In the target, past an optional quote: its start is read (UrlStartReader).
  | 'target';

/**
 * CSS text read one piece at a time, in constant memory (see the URL header): how much
 * of `@import` and of `url(` its last code units spell, ASCII case ignored, and where the
 * target of its last `url(` stands. Create with createCssScan, feed with feedCss;
 * `loads` once the text read so far loads a resource (loadsCssResource).
 */
interface CssScan {
  /** A style: a backslash anywhere, and an `@import`, load. Any other attribute value: a backslash from its first `url(` on. */
  readonly style: boolean;
  /** How many code units of CSS_IMPORT the last code units spell. */
  importMatched: number;
  /** How many code units of CSS_URL_OPEN the last code units spell. */
  urlMatched: number;
  phase: CssUrlPhase;
  /** The start of the target of the last `url(`, read while `phase` is 'target'. */
  target: UrlStartReader;
  /** A `url(` was read. */
  urlSeen: boolean;
  loads: boolean;
}

/** The style element the walk is inside (see the header). */
interface StyleText {
  /** How many elements were open around the style element; OUTSIDE_STYLE for none. */
  level: number;
  /** Its CSS text read so far. */
  css: CssScan;
}

// Bytes of the loose element name check (looseLocalStart): the delimiters that end a
// name under any reading, and the prefix separator.
const TAG_CLOSE = 0x3e; // '>'
const SLASH = 0x2f;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const COLON = 0x3a;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const ASCII_CASE_OFFSET = 0x20;

// The CSS a style may not hold (loadsCssResource), compared ASCII-folded. Neither
// pattern repeats its first code unit, which advanceMatch relies on.
const CSS_IMPORT = '@import';
const CSS_URL_OPEN = 'url(';
// A backslash: a CSS escape.
const CSS_ESCAPE = 0x5c;
// A '/' then this opens a CSS comment.
const ASTERISK = 0x2a;
// The bytes a value needs to hold `url(` once decoded: '(' itself, or the '&' of a reference.
const PARENTHESIS_OPEN = 0x28;
const AMPERSAND = 0x26;
// CSS white space (space, tab, line feed, carriage return, form feed) and quotes.
const CSS_SPACE: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c]);
const CSS_QUOTES: ReadonlySet<number> = new Set([0x22, 0x27]);
// A CDATA section's delimiters: its text lies between them.
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE_LENGTH = 3;

// The scans read a kept XML part in UTF-8. A part that another reader decodes in
// another encoding could hold markup or a formula the scans never see (UTF-7 writes
// 'W' as `+AFc-`), so every kept XML part must be UTF-8 text: valid UTF-8, no U+0000
// (XML has none, and a UTF-16 or UTF-32 part without a byte order mark has one in every
// ASCII character), and, when its first markup is a processing instruction, one the
// strict lexer reads that is not an XML declaration, or an XML declaration (target
// exactly `xml`) that names no encoding but UTF-8 (the worksheet index's rule).
const NUL = 0x00;

const REFERENCE_OPEN = '&';
const REFERENCE_CLOSE = ';';
const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
// The longest predefined entity name.
const MAX_PREDEFINED_ENTITY_LENGTH = 4;
// A character reference: '#', then decimal digits, or 'x' and hexadecimal digits.
const HASH = 0x23;
const LOWER_X = 0x78;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const LOWER_A = 0x61;
const LOWER_F = 0x66;
const HEXADECIMAL_LETTER_BASE = 10;
const DECIMAL_RADIX = 10;
const HEXADECIMAL_RADIX = 16;
const NOT_A_DIGIT = -1;
const MAX_CODE_POINT = 0x10ffff;
// A field may start with U+FEFF, which the default decoder would drop.
const FIELD_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

/** What the first bytes of a zip entry say it holds (see "Which entries are XML"). */
export type EntryContentKind = 'xml' | 'other' | 'misencoded';

/**
 * The first bytes of one entry, read chunk by chunk: `kind` is null until they decide.
 * Create with createEntryContentSniff; feed with feedEntryContentSniff.
 */
export interface EntryContentSniff {
  kind: EntryContentKind | null;
  /** The first bytes, held until the byte order mark is read. */
  readonly head: number[];
  headRead: boolean;
  /** The last leading byte (white space or U+0000) before the first other byte; NO_BYTE for none. */
  previous: number;
  /** The first other byte was '<'; the byte after it decides. */
  open: boolean;
}

function nameSet(names: readonly string[]): NameSet {
  const byLength = new Map<number, string[]>();
  for (const name of names) {
    const folded = foldAsciiCase(name);
    const sameLength = byLength.get(folded.length) ?? [];
    sameLength.push(folded);
    byLength.set(folded.length, sameLength);
  }
  return byLength;
}

const FORMULA_ELEMENTS = nameSet(FORMULA_ELEMENT_NAMES);
const FORMULA_ATTRIBUTES = nameSet(FORMULA_ATTRIBUTE_NAMES);
const ELEMENT_FORMULA_ATTRIBUTES: readonly (readonly [element: NameSet, attribute: NameSet])[] =
  ELEMENT_FORMULA_ATTRIBUTE_NAMES.map<readonly [NameSet, NameSet]>(([element, attribute]) => [
    nameSet([element]),
    nameSet([attribute]),
  ]);
// Every element that carries a field attribute of its own.
const FIELD_ATTRIBUTE_ELEMENTS = nameSet(
  ELEMENT_FORMULA_ATTRIBUTE_NAMES.map(([element]) => element),
);
const PIVOT_FORMULA_ELEMENTS = nameSet(PIVOT_FORMULA_ELEMENT_NAMES);
const PIVOT_FORMULA_ATTRIBUTE = nameSet([PIVOT_FORMULA_ATTRIBUTE_NAME]);
const INNER_FORMULA_ELEMENT = nameSet([INNER_FORMULA_ELEMENT_NAME]);
const URL_FRAGMENT_ELEMENTS = nameSet(URL_FRAGMENT_ELEMENT_NAMES);
const RELATIONSHIP_IDS = nameSet([RELATIONSHIP_ID_ATTRIBUTE]);
const MACRO_ATTRIBUTES = nameSet(MACRO_ATTRIBUTE_NAMES);
const MACRO_ELEMENTS = nameSet(MACRO_ELEMENT_NAMES);
const SCRIPT_ELEMENTS = nameSet(SCRIPT_ELEMENT_NAMES);
const URL_ATTRIBUTES = nameSet(URL_ATTRIBUTE_NAMES);
const BASE_URL_ATTRIBUTES = nameSet(BASE_URL_ATTRIBUTE_NAMES);
const STYLES = nameSet(STYLE_NAMES);
const STYLESHEET_INSTRUCTIONS = nameSet(STYLESHEET_INSTRUCTION_NAMES);
const ACTIVE_ELEMENTS = nameSet(ACTIVE_ELEMENT_NAMES);

/** Whether the entry `name` is one the grid reader may open: named `.xml` or `.xml.rels`. */
export function isXmlPart(name: string): boolean {
  return XML_PART_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function foldAsciiByte(byte: number | undefined): number | undefined {
  if (byte === undefined || byte < UPPER_A || byte > UPPER_Z) return byte;
  return byte + ASCII_CASE_OFFSET;
}

/** Whether the bytes from `start` spell `lowerName` (lower-case ASCII), ignoring ASCII case. */
function spellsFolded(bytes: Uint8Array, start: number, lowerName: string): boolean {
  for (let index = 0; index < lowerName.length; index += 1) {
    if (foldAsciiByte(bytes[start + index]) !== lowerName.charCodeAt(index)) return false;
  }
  return true;
}

/** Whether bytes [start, end) spell a name of `names`, ignoring ASCII case. Nothing is allocated. */
function isNameIn(bytes: Uint8Array, start: number, end: number, names: NameSet): boolean {
  const candidates = names.get(end - start);
  if (candidates === undefined) return false;
  for (const name of candidates) {
    if (spellsFolded(bytes, start, name)) return true;
  }
  return false;
}

function unsafeFormula(entry: string, message: string): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry, message);
}

function unsafePart(entry: string, message: string): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_PART, entry, message);
}

/**
 * UNSAFE_CONTENT `{ entry, cap }`: part `entry` holds more than
 * MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations. The one error both the
 * content scan of every kept XML part and the budget of the reader parts raise.
 */
export function tooManyNamespaceDeclarations(entry: string): SpreadsheetFileError {
  return new SpreadsheetFileError(
    'UNSAFE_CONTENT',
    `Workbook part '${entry}' has more than ${MAX_XMLNS_DECLARATIONS_PER_PART} namespace declarations`,
    { entry, cap: MAX_XMLNS_DECLARATIONS_PER_PART },
  );
}

/** A new sniff for one entry, nothing read yet. */
export function createEntryContentSniff(): EntryContentSniff {
  return { kind: null, head: [], headRead: false, previous: NO_BYTE, open: false };
}

function startsWithBytes(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** Reads one byte after the byte order mark; decides `kind` at the first byte that is not white space or U+0000. */
function sniffLeadingByte(sniff: EntryContentSniff, byte: number): void {
  if (sniff.open) {
    sniff.kind = byte === NUL ? 'misencoded' : 'xml';
    return;
  }
  if (byte === TAG_OPEN) {
    if (sniff.previous === NUL) sniff.kind = 'misencoded';
    else sniff.open = true;
    return;
  }
  if (byte === NUL || isXmlSpace(byte)) {
    sniff.previous = byte;
    return;
  }
  sniff.kind = 'other';
}

/** Reads the held first bytes: a UTF-16 or UTF-32 mark or an EBCDIC declaration decides, a UTF-8 mark is skipped. */
function readHead(sniff: EntryContentSniff): void {
  sniff.headRead = true;
  const misencoded =
    OTHER_BYTE_ORDER_MARKS.some((mark) => startsWithBytes(sniff.head, mark)) ||
    startsWithBytes(sniff.head, EBCDIC_DECLARATION_START);
  if (misencoded) {
    sniff.kind = 'misencoded';
    return;
  }
  const skip = startsWithBytes(sniff.head, UTF8_BYTE_ORDER_MARK) ? UTF8_BYTE_ORDER_MARK.length : 0;
  for (let index = skip; index < sniff.head.length && sniff.kind === null; index += 1) {
    sniffLeadingByte(sniff, sniff.head[index] ?? NUL);
  }
}

/** Reads the next chunk of the entry; stops at the byte that decides. */
export function feedEntryContentSniff(sniff: EntryContentSniff, chunk: Uint8Array): void {
  for (const byte of chunk) {
    if (sniff.kind !== null) return;
    if (sniff.headRead) {
      sniffLeadingByte(sniff, byte);
      continue;
    }
    sniff.head.push(byte);
    if (sniff.head.length === BYTE_ORDER_MARK_LENGTH) readHead(sniff);
  }
}

/**
 * Decides `sniff.kind` once all of the entry was fed and returns it: a '<' that ends the
 * entry is XML, bytes that never decided (white space only, or nothing) are not.
 */
export function finishEntryContentSniff(sniff: EntryContentSniff): EntryContentKind {
  if (!sniff.headRead) readHead(sniff);
  const kind = sniff.kind ?? (sniff.open ? 'xml' : 'other');
  sniff.kind = kind;
  return kind;
}

/** The kind of a whole entry `bytes`. */
export function entryContentKind(bytes: Uint8Array): EntryContentKind {
  const sniff = createEntryContentSniff();
  feedEntryContentSniff(sniff, bytes);
  return finishEntryContentSniff(sniff);
}

/** CORRUPT_FILE `{ reason: 'part-encoding', entry }`, the message `Workbook part <detail>`. */
function partEncodingError(entry: string, detail: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', `Workbook part ${detail}`, {
    reason: ZIP_REJECT_REASONS.PART_ENCODING,
    entry: metaEntryName(entry),
  });
}

/**
 * Throws CORRUPT_FILE `{ reason: 'part-encoding', entry }` for entry `name` of `kind`
 * when it is XML the scans cannot read (`misencoded`), or not XML while its ASCII-folded
 * name ends in `.xml`, `.rels` or `.vml` (see "Which entries are XML").
 */
export function assertEntryContentKind(name: string, kind: EntryContentKind): void {
  if (kind === 'misencoded') {
    throw partEncodingError(name, 'is UTF-16, UTF-32 or EBCDIC text, which the scans cannot read');
  }
  if (kind === 'xml') return;
  const folded = foldAsciiCase(name);
  if (XML_CONTENT_NAME_SUFFIXES.some((suffix) => folded.endsWith(suffix))) {
    throw partEncodingError(name, 'is named for XML content but does not hold XML');
  }
}

/** Reads the markup at the '<' at `at` into `markup` and `attributes`; false when the strict lexer refuses it. */
function lexes(bytes: Uint8Array, at: number, markup: XmlMarkup, attributes?: number[]): boolean {
  try {
    scanMarkup(bytes, at, markup, attributes);
    return true;
  } catch (error) {
    if (error instanceof XmlLexError) return false;
    throw error;
  }
}

/** The value of digit `code` in `radix` (10, or 16 with letters in either case), or NOT_A_DIGIT. */
function digitValue(code: number, radix: number): number {
  if (code >= DIGIT_ZERO && code <= DIGIT_NINE) return code - DIGIT_ZERO;
  if (radix !== HEXADECIMAL_RADIX) return NOT_A_DIGIT;
  const lower = foldAsciiByte(code) ?? NOT_A_DIGIT;
  if (lower >= LOWER_A && lower <= LOWER_F) return lower - LOWER_A + HEXADECIMAL_LETTER_BASE;
  return NOT_A_DIGIT;
}

/**
 * The character the reference whose name is `text` [start, end) (between '&' and ';')
 * stands for: a predefined entity, or a decimal (`#87`) or hexadecimal (`#x57`)
 * character reference up to U+10FFFF. Null for any other name. Read by hand, one pass,
 * so a reference with millions of digits costs one look at each.
 */
function referenceText(text: string, start: number, end: number): string | null {
  if (end - start <= MAX_PREDEFINED_ENTITY_LENGTH) {
    const predefined = PREDEFINED_ENTITIES.get(text.slice(start, end));
    if (predefined !== undefined) return predefined;
  }
  if (text.charCodeAt(start) !== HASH) return null;
  const hexadecimal = text.charCodeAt(start + 1) === LOWER_X;
  const radix = hexadecimal ? HEXADECIMAL_RADIX : DECIMAL_RADIX;
  const digitsStart = hexadecimal ? start + 2 : start + 1;
  if (digitsStart >= end) return null;
  let codePoint = 0;
  for (let at = digitsStart; at < end; at += 1) {
    const digit = digitValue(text.charCodeAt(at), radix);
    if (digit === NOT_A_DIGIT) return null;
    codePoint = codePoint * radix + digit;
    if (codePoint > MAX_CODE_POINT) return null;
  }
  return String.fromCodePoint(codePoint);
}

/**
 * The text of raw XML character data or attribute value bytes `raw`, decoded from UTF-8
 * with every predefined and character reference replaced; null when it holds any other
 * reference (its text is unknown).
 */
export function decodeXmlText(raw: Uint8Array): string | null {
  const text = FIELD_DECODER.decode(raw);
  let decoded = '';
  let from = 0;
  for (
    let open = text.indexOf(REFERENCE_OPEN);
    open !== -1;
    open = text.indexOf(REFERENCE_OPEN, from)
  ) {
    const close = text.indexOf(REFERENCE_CLOSE, open + 1);
    const character = close === -1 ? null : referenceText(text, open + 1, close);
    if (character === null) return null;
    decoded += text.slice(from, open) + character;
    from = close + 1;
  }
  return decoded + text.slice(from);
}

/**
 * Decodes formula field bytes `raw` and checks them (formula-scan.ts), its quoted
 * sections read as `quoted`; UNSAFE_CONTENT `unsafe-formula` otherwise.
 */
function assertSafeFormulaField(
  entry: string,
  raw: Uint8Array,
  quoted: QuotedSection = 'sheet-name',
): void {
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafeFormula(
      entry,
      'Workbook part holds a formula with a reference the scan cannot decode',
    );
  }
  const refusal = formulaTextRefusal(text, quoted);
  if (refusal !== null) throw unsafeFormula(entry, refusal);
}

function notTextOnly(entry: string): SpreadsheetFileError {
  return unsafeFormula(entry, 'Workbook part holds a formula field with something other than text');
}

/** Whether the end tag scanned into `markup` closes the element named by bytes [nameStart, nameEnd). */
function closesElement(
  bytes: Uint8Array,
  markup: XmlMarkup,
  nameStart: number,
  nameEnd: number,
): boolean {
  const nameLength = nameEnd - nameStart;
  return (
    markup.kind === 'end' &&
    markup.nameEnd - markup.nameStart === nameLength &&
    bytesEqualAt(bytes, nameStart, bytes, markup.nameStart, nameLength)
  );
}

/**
 * The offset of the end tag of the element whose start tag is scanned into `markup`,
 * which must follow its content directly: text only, no other markup. The end tag is
 * left in `markup`. UNSAFE_CONTENT `unsafe-formula` otherwise.
 */
function textOnlyContentEnd(entry: string, bytes: Uint8Array, markup: XmlMarkup): number {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const close = nextMarkup(bytes, markup.end);
  const textOnly =
    close !== -1 && lexes(bytes, close, markup) && closesElement(bytes, markup, nameStart, nameEnd);
  if (!textOnly) throw notTextOnly(entry);
  return close;
}

/** Whether bytes [start, end) are XML white space only. */
function isXmlSpaceOnly(bytes: Uint8Array, start: number, end: number): boolean {
  for (let at = start; at < end; at += 1) {
    if (!isXmlSpace(bytes[at])) return false;
  }
  return true;
}

/**
 * Checks the content of the formula field element whose start tag is scanned into
 * `markup`, up to its own end tag (left in `markup`): text that passes the scan, or
 * exactly one child element whose local name is `f`, with safe attributes and text only
 * that passes the scan, and nothing but white space around it (see the header).
 * UNSAFE_CONTENT `unsafe-formula` otherwise.
 */
function assertSafeFieldContent(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
): void {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const contentStart = markup.end;
  const next = nextMarkup(bytes, contentStart);
  if (next === -1 || !lexes(bytes, next, markup, attributes)) throw notTextOnly(entry);
  if (closesElement(bytes, markup, nameStart, nameEnd)) {
    assertSafeFormulaField(entry, bytes.subarray(contentStart, next));
    return;
  }
  const innerChild =
    markup.kind === 'start' &&
    isNameIn(bytes, localNameStart(bytes, markup), markup.nameEnd, INNER_FORMULA_ELEMENT) &&
    isXmlSpaceOnly(bytes, contentStart, next);
  if (!innerChild) throw notTextOnly(entry);
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    assertSafeAttribute(entry, bytes, attributes, attribute, null, 'sheet-name');
  }
  const innerStart = markup.end;
  const innerClose = textOnlyContentEnd(entry, bytes, markup);
  assertSafeFormulaField(entry, bytes.subarray(innerStart, innerClose));
  const innerEnd = markup.end;
  const close = nextMarkup(bytes, innerEnd);
  const closed =
    close !== -1 &&
    isXmlSpaceOnly(bytes, innerEnd, close) &&
    lexes(bytes, close, markup) &&
    closesElement(bytes, markup, nameStart, nameEnd);
  if (!closed) throw notTextOnly(entry);
}

/**
 * Reads the content of the script element whose start tag is scanned into `markup` up
 * to its own end tag (left in `markup`): white space only, or UNSAFE_CONTENT
 * `unsafe-formula`.
 */
function assertNoScript(entry: string, bytes: Uint8Array, markup: XmlMarkup): void {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const contentStart = markup.end;
  const close = nextMarkup(bytes, contentStart);
  const empty =
    close !== -1 &&
    isXmlSpaceOnly(bytes, contentStart, close) &&
    lexes(bytes, close, markup) &&
    closesElement(bytes, markup, nameStart, nameEnd);
  if (!empty) throw unsafeFormula(entry, 'Workbook part holds a script');
}

/**
 * Decodes URL attribute value bytes `raw`: a relative URL, or, with `dataImage`, a value
 * whose ASCII-folded text starts with DATA_IMAGE_URL_START; UNSAFE_CONTENT `unsafe-part`
 * otherwise.
 */
function assertRelativeUrl(entry: string, raw: Uint8Array, dataImage: boolean): void {
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafePart(entry, 'Workbook part links to a resource the scan cannot decode');
  }
  const head = foldAsciiCase(text.slice(0, DATA_IMAGE_URL_START.length));
  if (dataImage && head === DATA_IMAGE_URL_START) return;
  if (isAbsoluteUrl(text)) {
    throw unsafePart(entry, 'Workbook part links to a resource outside the package');
  }
}

/** A new CssScan, nothing read yet; `style` says whether the text is a style (see CssScan). */
function createCssScan(style: boolean): CssScan {
  return {
    style,
    importMatched: 0,
    urlMatched: 0,
    phase: 'none',
    target: createUrlStartReader(),
    urlSeen: false,
    loads: false,
  };
}

/** `code` with an ASCII capital letter folded to lower case. */
function foldAsciiCode(code: number): number {
  return code >= UPPER_A && code <= UPPER_Z ? code + ASCII_CASE_OFFSET : code;
}

/**
 * How many code units of `pattern` the text spells after `code` (folded), given that it
 * spelled `matched` of them before. Exact for a pattern whose first code unit does not
 * repeat in it (CSS_IMPORT, CSS_URL_OPEN): no shorter match can then be pending.
 */
function advanceMatch(pattern: string, matched: number, code: number): number {
  if (code === pattern.charCodeAt(matched)) return matched + 1;
  return code === pattern.charCodeAt(0) ? 1 : 0;
}

/**
 * Reads `code` into the target of the last `url(` (see loadsCssResource): past CSS
 * white space, a `/*` loads; past an optional quote, the start of the target is read
 * (readUrlStart) and an absolute one loads. A '(' always decides a pending target, so
 * one is pending at a time.
 */
function readCssUrlTarget(scan: CssScan, code: number): void {
  const phase = scan.phase;
  switch (phase) {
    case 'none':
      return;
    case 'space':
      if (CSS_SPACE.has(code)) return;
      if (code === SLASH) {
        scan.phase = 'slash';
        return;
      }
      scan.target = createUrlStartReader();
      scan.phase = 'target';
      if (CSS_QUOTES.has(code)) return;
      break;
    case 'slash':
      if (code === ASTERISK) {
        scan.loads = true;
        return;
      }
      scan.target = createUrlStartReader();
      readUrlStart(scan.target, SLASH);
      scan.phase = 'target';
      break;
    case 'target':
      break;
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled CSS url phase: ${String(_exhaustive)}`);
    }
  }
  const verdict = readUrlStart(scan.target, code);
  if (verdict === 'absolute') scan.loads = true;
  if (verdict !== 'pending') scan.phase = 'none';
}

/** Reads the next piece `text` of the CSS of `scan`, up to the code unit that makes it load. */
function feedCss(scan: CssScan, text: string): void {
  for (let at = 0; at < text.length && !scan.loads; at += 1) {
    const code = text.charCodeAt(at);
    if (code === CSS_ESCAPE && (scan.style || scan.urlSeen)) {
      scan.loads = true;
      return;
    }
    readCssUrlTarget(scan, code);
    const folded = foldAsciiCode(code);
    scan.urlMatched = advanceMatch(CSS_URL_OPEN, scan.urlMatched, folded);
    if (scan.urlMatched === CSS_URL_OPEN.length) {
      scan.urlMatched = 0;
      scan.urlSeen = true;
      scan.phase = 'space';
    }
    if (!scan.style) continue;
    scan.importMatched = advanceMatch(CSS_IMPORT, scan.importMatched, folded);
    if (scan.importMatched === CSS_IMPORT.length) scan.loads = true;
  }
}

/**
 * Whether decoded CSS text `css` may load a resource (see the header): a `url(` whose
 * target, past CSS white space and an optional quote, starts an absolute URL
 * (readUrlStart, which decides before the quote or ')' that ends the target) or a
 * comment; in a `style`, also a backslash anywhere or an `@import`, and in any other
 * attribute value a backslash from its first `url(` on. ASCII case is ignored. One pass
 * (feedCss); a style element's text is fed piece by piece instead.
 */
function loadsCssResource(css: string, style: boolean): boolean {
  const scan = createCssScan(style);
  feedCss(scan, css);
  return scan.loads;
}

/** Decodes style attribute value bytes `raw`: CSS that loads nothing, or UNSAFE_CONTENT `unsafe-part`. */
function assertSafeStyleAttribute(entry: string, raw: Uint8Array): void {
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafePart(entry, 'Workbook part holds a style the scan cannot decode');
  }
  if (loadsCssResource(text, true)) {
    throw unsafePart(entry, 'Workbook part holds a style that loads a resource');
  }
}

/**
 * The value bytes `raw` of an attribute that is no style hold no `url(` that loads a
 * resource (loadsCssResource), or UNSAFE_CONTENT `unsafe-part`; so does a value that
 * cannot be decoded. Only a value with a '(' or a reference can hold one once decoded,
 * so no other is decoded.
 */
function assertNoCssUrl(entry: string, raw: Uint8Array): void {
  if (!raw.includes(PARENTHESIS_OPEN) && !raw.includes(AMPERSAND)) return;
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafePart(entry, 'Workbook part holds an attribute value the scan cannot decode');
  }
  if (loadsCssResource(text, false)) {
    throw unsafePart(entry, 'Workbook part holds a url() that loads a resource');
  }
}

/** Whether the attribute whose local name is bytes [start, end) names a URL: `src`, or any name that ends with `href` (ASCII case ignored). */
function isUrlAttributeName(bytes: Uint8Array, start: number, end: number): boolean {
  if (isNameIn(bytes, start, end, URL_ATTRIBUTES)) return true;
  const suffixStart = end - URL_ATTRIBUTE_SUFFIX.length;
  return suffixStart >= start && spellsFolded(bytes, suffixStart, URL_ATTRIBUTE_SUFFIX);
}

/** Whether attribute name bytes [start, end) declare a namespace: `xmlns` or `xmlns:` and a prefix. */
function isNamespaceDeclaration(bytes: Uint8Array, start: number, end: number): boolean {
  if (bytesEqualAscii(bytes, start, end, NAMESPACE_DECLARATION)) return true;
  const prefixEnd = start + NAMESPACE_DECLARATION_PREFIX.length;
  return end > prefixEnd && bytesEqualAscii(bytes, start, prefixEnd, NAMESPACE_DECLARATION_PREFIX);
}

/** Where the local part of name bytes [start, end) starts: past its last ':'. */
function localPartStart(bytes: Uint8Array, start: number, end: number): number {
  let local = start;
  for (let at = start; at < end; at += 1) {
    if (bytes[at] === COLON) local = at + 1;
  }
  return local;
}

/**
 * Checks attribute `attribute` of the scanned tag: a formula field (a FORMULA_ATTRIBUTES
 * attribute, or the `elementField` attribute of this element) passes the scan, its
 * `formula` attribute read with quoted sections as `formulaQuotes`; a macro is empty; a
 * style loads nothing; any other value holds no `url(` that loads a resource, and a URL
 * attribute is relative or an image data URI, a base URL relative.
 */
function assertSafeAttribute(
  entry: string,
  bytes: Uint8Array,
  attributes: readonly number[],
  attribute: number,
  elementField: NameSet | null,
  formulaQuotes: QuotedSection,
): void {
  const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
  const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
  const valueStart = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
  const valueEnd = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
  if (valueStart === valueEnd || isNamespaceDeclaration(bytes, nameStart, nameEnd)) return;
  const localStart = localPartStart(bytes, nameStart, nameEnd);
  if (isNameIn(bytes, localStart, nameEnd, MACRO_ATTRIBUTES)) {
    throw unsafeFormula(entry, 'Workbook part assigns a macro');
  }
  const raw = bytes.subarray(valueStart, valueEnd);
  if (isNameIn(bytes, localStart, nameEnd, STYLES)) {
    assertSafeStyleAttribute(entry, raw);
    return;
  }
  assertNoCssUrl(entry, raw);
  if (isUrlAttributeName(bytes, localStart, nameEnd)) {
    assertRelativeUrl(entry, raw, true);
    return;
  }
  if (isNameIn(bytes, localStart, nameEnd, BASE_URL_ATTRIBUTES)) {
    assertRelativeUrl(entry, raw, false);
    return;
  }
  const field =
    isNameIn(bytes, localStart, nameEnd, FORMULA_ATTRIBUTES) ||
    (elementField !== null && isNameIn(bytes, localStart, nameEnd, elementField));
  if (!field) return;
  const quoted = isNameIn(bytes, localStart, nameEnd, PIVOT_FORMULA_ATTRIBUTE)
    ? formulaQuotes
    : 'sheet-name';
  assertSafeFormulaField(entry, raw, quoted);
}

/** The field attribute of its own the element whose local name is bytes [start, end) carries, or null. */
function elementFormulaAttribute(bytes: Uint8Array, start: number, end: number): NameSet | null {
  for (const [element, attribute] of ELEMENT_FORMULA_ATTRIBUTES) {
    if (isNameIn(bytes, start, end, element)) return attribute;
  }
  return null;
}

/**
 * Refuses, UNSAFE_CONTENT `unsafe-part`, the tag scanned into `markup`, of an element
 * that is no hyperlink, when it names an external hyperlink of its part (see the
 * header): a prefixed attribute whose local name is `id` (ASCII case ignored, any
 * namespace) and whose decoded value is one of `externalIds`, or cannot be decoded.
 */
function assertNoExternalHyperlinkId(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  externalIds: ReadonlySet<string>,
): void {
  if (externalIds.size === 0) return;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    if (localStart === nameStart || !isNameIn(bytes, localStart, nameEnd, RELATIONSHIP_IDS)) {
      continue;
    }
    const id = decodeXmlText(
      bytes.subarray(
        attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
        attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
      ),
    );
    if (id === null || externalIds.has(id)) {
      throw unsafePart(entry, 'Workbook part names an external hyperlink from another element');
    }
  }
}

/**
 * Checks the start or empty tag scanned into `markup` with its `attributes` (see the
 * formula field header): no active element, no element but a hyperlink that names an
 * external hyperlink of this part (`hyperlinkIds`), every field attribute safe (a
 * hyperlink's `location` unless its relationship ids by `scopes` are only external
 * hyperlinks of this part), and, for a start tag of a field element outside the OMML
 * namespace (`scopes`), its content up to its own end tag (left in `markup`;
 * assertSafeFieldContent), empty for a macro element, white space only for a script
 * element.
 */
function assertSafeElement(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  scopes: NamespaceScopes,
  hyperlinkIds: WorksheetHyperlinkIds,
): void {
  const localStart = localNameStart(bytes, markup);
  const localEnd = markup.nameEnd;
  if (isNameIn(bytes, localStart, localEnd, ACTIVE_ELEMENTS)) {
    throw unsafePart(
      entry,
      'Workbook part holds an embedded object, a control, a script or a web publishing item',
    );
  }
  const hyperlink = isNameIn(bytes, localStart, localEnd, URL_FRAGMENT_ELEMENTS);
  if (!hyperlink) {
    assertNoExternalHyperlinkId(entry, bytes, markup, attributes, hyperlinkIds.external);
  }
  const urlFragment =
    hyperlink &&
    leadsToExternalHyperlink(scopes, bytes, markup, attributes, hyperlinkIds.onlyExternal);
  const elementField = urlFragment ? null : elementFormulaAttribute(bytes, localStart, localEnd);
  const formulaQuotes: QuotedSection = isNameIn(bytes, localStart, localEnd, PIVOT_FORMULA_ELEMENTS)
    ? 'field-name'
    : 'sheet-name';
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    assertSafeAttribute(entry, bytes, attributes, attribute, elementField, formulaQuotes);
  }
  if (markup.kind !== 'start') return;
  const contentStart = markup.end;
  if (isNameIn(bytes, localStart, localEnd, MACRO_ELEMENTS)) {
    if (textOnlyContentEnd(entry, bytes, markup) !== contentStart) {
      throw unsafeFormula(entry, 'Workbook part assigns a macro');
    }
    return;
  }
  if (isNameIn(bytes, localStart, localEnd, SCRIPT_ELEMENTS)) {
    assertNoScript(entry, bytes, markup);
    return;
  }
  if (!isNameIn(bytes, localStart, localEnd, FORMULA_ELEMENTS)) return;
  if (inOmmlNamespace(scopes, bytes, markup)) return;
  assertSafeFieldContent(entry, bytes, markup, attributes);
}

function createNamespaceScopes(): NamespaceScopes {
  return {
    bindings: new Map(),
    declaring: [],
    openNames: [],
    depth: 0,
    declarationsInScope: 0,
    broken: false,
  };
}

/** The namespace the declaration value bytes [start, end) name. */
function knownNamespace(bytes: Uint8Array, start: number, end: number): KnownNamespace {
  for (const [uri, namespace] of KNOWN_NAMESPACES) {
    if (bytesEqualAscii(bytes, start, end, uri)) return namespace;
  }
  return 'other';
}

/**
 * Counts the namespace declarations of the start or empty tag scanned into `markup` into
 * the declarations in scope, at most MAX_XMLNS_DECLARATIONS_PER_PART for part `entry`
 * (tooManyNamespaceDeclarations past it), and, while bindings count, binds them in
 * `scopes` at the current level. The prefixes it bound (to release with
 * releaseNamespaces), or null for none.
 */
function declareNamespaces(
  entry: string,
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): string[] | null {
  const level = scopes.depth;
  // Allocated at the first binding only: most elements declare none.
  let prefixes: string[] | null = null;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (!isNamespaceDeclaration(bytes, nameStart, nameEnd)) continue;
    scopes.declarationsInScope += 1;
    if (scopes.declarationsInScope > MAX_XMLNS_DECLARATIONS_PER_PART) {
      throw tooManyNamespaceDeclarations(entry);
    }
    if (scopes.broken) continue;
    const key =
      nameEnd === nameStart + NAMESPACE_DECLARATION.length
        ? DEFAULT_NAMESPACE_KEY
        : NAME_DECODER.decode(
            bytes.subarray(nameStart + NAMESPACE_DECLARATION_PREFIX.length, nameEnd),
          );
    const namespace = knownNamespace(
      bytes,
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
    );
    const stack = scopes.bindings.get(key) ?? [];
    scopes.bindings.set(key, stack);
    const innermost = stack.at(-1);
    // Only this element binds at this level: every element bound before at it is closed.
    if (innermost !== undefined && innermost.level === level) {
      if (innermost.namespace !== namespace) innermost.namespace = 'other';
      continue;
    }
    stack.push({ level, namespace });
    prefixes ??= [];
    prefixes.push(key);
  }
  return prefixes;
}

/**
 * Removes the bindings of `prefixes`, the innermost of each, from `scopes`, and a prefix
 * whose last binding that was: only prefixes in scope stay held (see the header).
 */
function releaseNamespaces(scopes: NamespaceScopes, prefixes: readonly string[]): void {
  for (const key of prefixes) {
    const stack = scopes.bindings.get(key);
    if (stack === undefined) continue;
    stack.pop();
    if (stack.length === 0) scopes.bindings.delete(key);
  }
}

/**
 * Ends an element that never opens (an empty tag, or one read through its end tag),
 * which bound `prefixes` and held `declarations` namespace declarations: they leave
 * scope. Once the walk lost the nesting, declarations never leave scope.
 */
function endUnopenedElement(
  scopes: NamespaceScopes,
  prefixes: readonly string[] | null,
  declarations: number,
): void {
  if (scopes.broken) return;
  if (prefixes !== null) releaseNamespaces(scopes, prefixes);
  scopes.declarationsInScope -= declarations;
}

/**
 * Opens the element whose start tag names bytes [nameStart, nameEnd), which bound
 * `prefixes` and held `declarations` namespace declarations: its name on the stack of
 * open names, one level deeper, and an entry when it declared namespaces. Past
 * MAX_TRACKED_ELEMENT_DEPTH open elements, no binding counts from there on.
 */
function openElement(
  scopes: NamespaceScopes,
  nameStart: number,
  nameEnd: number,
  prefixes: readonly string[] | null,
  declarations: number,
): void {
  if (scopes.broken) return;
  if (scopes.depth === MAX_TRACKED_ELEMENT_DEPTH) {
    scopes.broken = true;
    return;
  }
  if (declarations > 0) {
    scopes.declaring.push({ level: scopes.depth, prefixes: prefixes ?? [], declarations });
  }
  scopes.openNames.push(nameStart, nameEnd);
  scopes.depth += 1;
}

/**
 * Closes the innermost open element with the end tag scanned into `markup`, which must
 * name it byte for byte, and releases the bindings and declarations of a declaring one.
 * An end tag that names another element, or one with no element open, leaves no binding
 * counting from there on.
 */
function closeElement(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): void {
  if (scopes.broken) return;
  const nameEnd = scopes.openNames.pop();
  const nameStart = scopes.openNames.pop();
  if (
    nameStart === undefined ||
    nameEnd === undefined ||
    !closesElement(bytes, markup, nameStart, nameEnd)
  ) {
    scopes.broken = true;
    return;
  }
  scopes.depth -= 1;
  const innermost = scopes.declaring.at(-1);
  if (innermost === undefined || innermost.level !== scopes.depth) return;
  scopes.declaring.pop();
  releaseNamespaces(scopes, innermost.prefixes);
  scopes.declarationsInScope -= innermost.declarations;
}

/** The namespace the innermost binding of prefix `key` names in `scopes`, or null when none counts. */
function boundNamespace(scopes: NamespaceScopes, key: string): KnownNamespace | null {
  if (scopes.broken) return null;
  return scopes.bindings.get(key)?.at(-1)?.namespace ?? null;
}

/** Whether the element scanned into `markup` is in OMML_NAMESPACE by the bindings of `scopes`. */
function inOmmlNamespace(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): boolean {
  const localStart = localNameStart(bytes, markup);
  const key =
    localStart === markup.nameStart
      ? DEFAULT_NAMESPACE_KEY
      : NAME_DECODER.decode(bytes.subarray(markup.nameStart, localStart - 1));
  return boundNamespace(scopes, key) === 'omml';
}

/**
 * Whether the tag scanned into `markup` leads to an external hyperlink of its part: it
 * has a relationship id (a non-empty attribute whose local name is exactly
 * RELATIONSHIP_ID_ATTRIBUTE and whose prefix is bound to RELATIONSHIPS_NAMESPACE by
 * `scopes`), and the decoded value of every one it has is one of `externalHyperlinkIds`.
 */
function leadsToExternalHyperlink(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  externalHyperlinkIds: ReadonlySet<string>,
): boolean {
  if (externalHyperlinkIds.size === 0) return false;
  let found = false;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    const valueStart = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
    const valueEnd = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    const candidate =
      localStart > nameStart &&
      valueStart !== valueEnd &&
      bytesEqualAscii(bytes, localStart, nameEnd, RELATIONSHIP_ID_ATTRIBUTE);
    if (!candidate) continue;
    const key = NAME_DECODER.decode(bytes.subarray(nameStart, localStart - 1));
    if (boundNamespace(scopes, key) !== 'relationships') continue;
    const id = decodeXmlText(bytes.subarray(valueStart, valueEnd));
    if (id === null || !externalHyperlinkIds.has(id)) return false;
    found = true;
  }
  return found;
}

/** A byte inside a loose element name: anything above a space but `<`, `>`, `/`, `=` and quotes. */
function isLooseNameByte(byte: number | undefined): boolean {
  return (
    byte !== undefined &&
    byte > SPACE &&
    byte !== TAG_OPEN &&
    byte !== TAG_CLOSE &&
    byte !== SLASH &&
    byte !== EQUALS &&
    byte !== QUOTE &&
    byte !== APOSTROPHE
  );
}

/** Where the local part of the loose element name that starts at `nameStart` (right after a '<') starts: past its last ':'. */
function looseLocalStart(bytes: Uint8Array, nameStart: number): number {
  let localStart = nameStart;
  for (let at = nameStart; isLooseNameByte(bytes[at]); at += 1) {
    if (bytes[at] === COLON) localStart = at + 1;
  }
  return localStart;
}

/**
 * Whether any '<' of `bytes` opens an element whose loose local name (looseLocalStart:
 * the name a lenient reader takes, past its last ':') is `localName`, ASCII case
 * ignored. For a part the strict lexer cannot read. Linear: every loose name stops
 * before the next '<'.
 */
export function opensLooseElement(bytes: Uint8Array, localName: string): boolean {
  const names = nameSet([localName]);
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, at + 1)) {
    const localStart = looseLocalStart(bytes, at + 1);
    let localEnd = localStart;
    while (isLooseNameByte(bytes[localEnd])) localEnd += 1;
    if (isNameIn(bytes, localStart, localEnd, names)) return true;
  }
  return false;
}

/** The end of the run of bytes the strict lexer takes into a name (ASCII letters, digits, '_', '-', '.') from `start`. */
function strictNameEnd(bytes: Uint8Array, start: number): number {
  let at = start;
  while (isNameByte(bytes[at])) at += 1;
  return at;
}

/**
 * After markup the strict lexer refuses at `from`, refuses the part when any '<' from
 * there on could open a field, macro, script or active element or an element with a
 * field attribute of its own (the strict-name head of its loose local name, which a
 * reader that stops at U+0080 or a non-ASCII letter reads, is one), any run of name
 * bytes is a field, macro, URL, base URL or style name or a stylesheet instruction
 * target, or ends a `url(` (ASCII case ignored), any `&#` opens a character reference
 * (it could spell one), or, with `externalIds` (the part's external hyperlinks), a run
 * after a ':' is `id`. Linear: every loose name stops before the next '<', every run of
 * name bytes is read once.
 */
function assertNoFieldAfter(
  entry: string,
  bytes: Uint8Array,
  from: number,
  externalIds: ReadonlySet<string>,
): void {
  for (let at = from; at !== -1; at = nextMarkup(bytes, at + 1)) {
    const localStart = looseLocalStart(bytes, at + 1);
    const headEnd = strictNameEnd(bytes, localStart);
    if (isNameIn(bytes, localStart, headEnd, ACTIVE_ELEMENTS)) {
      throw unsafePart(entry, 'Workbook part holds an active element the strict lexer cannot read');
    }
    if (
      isNameIn(bytes, localStart, headEnd, FORMULA_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, FIELD_ATTRIBUTE_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, MACRO_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, SCRIPT_ELEMENTS)
    ) {
      throw unsafeFormula(entry, 'Workbook part holds a formula the strict lexer cannot read');
    }
  }
  let at = from;
  while (at < bytes.length) {
    if (!isNameByte(bytes[at])) {
      if (bytes[at] === AMPERSAND && bytes[at + 1] === HASH) {
        throw unsafePart(entry, 'Workbook part holds a reference the strict lexer cannot read');
      }
      at += 1;
      continue;
    }
    const end = strictNameEnd(bytes, at);
    if (
      isNameIn(bytes, at, end, FORMULA_ATTRIBUTES) ||
      isNameIn(bytes, at, end, MACRO_ATTRIBUTES)
    ) {
      throw unsafeFormula(entry, 'Workbook part holds a formula the strict lexer cannot read');
    }
    const urlOpen = end - (CSS_URL_OPEN.length - 1);
    const link =
      isUrlAttributeName(bytes, at, end) ||
      isNameIn(bytes, at, end, BASE_URL_ATTRIBUTES) ||
      isNameIn(bytes, at, end, STYLES) ||
      isNameIn(bytes, at, end, STYLESHEET_INSTRUCTIONS) ||
      (urlOpen >= at && spellsFolded(bytes, urlOpen, CSS_URL_OPEN)) ||
      (externalIds.size > 0 &&
        bytes[at - 1] === COLON &&
        isNameIn(bytes, at, end, RELATIONSHIP_IDS));
    if (link) {
      throw unsafePart(entry, 'Workbook part holds a link the strict lexer cannot read');
    }
    at = end;
  }
}

/** Whether the opaque markup scanned into `markup` is a processing instruction that loads a resource. */
function isStylesheetInstruction(bytes: Uint8Array, markup: XmlMarkup): boolean {
  return (
    bytes[markup.start + 1] === QUESTION &&
    isNameIn(bytes, markup.nameStart, markup.nameEnd, STYLESHEET_INSTRUCTIONS)
  );
}

/** Feeds the character data bytes `raw`, decoded, to the CSS of `style`; UNSAFE_CONTENT `unsafe-part` when it cannot be decoded. */
function addStyleText(entry: string, style: StyleText, raw: Uint8Array): void {
  if (raw.length === 0) return;
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafePart(entry, 'Workbook part holds a style the scan cannot decode');
  }
  feedCss(style.css, text);
}

/** Feeds the text of the CDATA section scanned into `markup`, if it is one, to the CSS of `style`. */
function addStyleCdata(bytes: Uint8Array, markup: XmlMarkup, style: StyleText): void {
  if (!bytesEqualAscii(bytes, markup.start, markup.start + CDATA_OPEN.length, CDATA_OPEN)) return;
  feedCss(
    style.css,
    FIELD_DECODER.decode(
      bytes.subarray(markup.start + CDATA_OPEN.length, markup.end - CDATA_CLOSE_LENGTH),
    ),
  );
}

/**
 * The CSS of the style element that ended (or of the rest of the part, when the walk
 * lost the nesting inside it) loads nothing (loadsCssResource), or UNSAFE_CONTENT
 * `unsafe-part`; then `style` leaves it.
 */
function endStyle(entry: string, style: StyleText): void {
  if (style.css.loads) {
    throw unsafePart(entry, 'Workbook part holds a style that loads a resource');
  }
  style.level = OUTSIDE_STYLE;
  style.css = createCssScan(true);
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason, entry }` when XML part `entry`
 * holds a formula field that fails the scan, a macro assignment or a script
 * (`unsafe-formula`), an active element, a URL outside the package, a style that loads a
 * resource or a stylesheet instruction (`unsafe-part`), or, past markup the strict
 * lexer refuses, anything that could be one (see the formula field header);
 * UNSAFE_CONTENT `{ entry, cap }` when it holds more than MAX_XMLNS_DECLARATIONS_PER_PART
 * namespace declarations in scope at once. A hyperlink's `location` is a URL fragment
 * only with relationship ids that `hyperlinkIds` gives only an external hyperlink, and
 * no other element may name one it gives one. Every markup of the part is read, the
 * open elements and the namespace declarations in scope kept on the way, and the text
 * of a style element read piece by piece up to its end tag.
 */
function assertSafeFields(
  entry: string,
  bytes: Uint8Array,
  hyperlinkIds: WorksheetHyperlinkIds,
): void {
  const markup = createMarkup();
  const attributes: number[] = [];
  const scopes = createNamespaceScopes();
  const style: StyleText = { level: OUTSIDE_STYLE, css: createCssScan(true) };
  let textStart = 0;
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
    const inStyle = style.level !== OUTSIDE_STYLE;
    if (inStyle) addStyleText(entry, style, bytes.subarray(textStart, at));
    if (!lexes(bytes, at, markup, attributes)) {
      if (inStyle) {
        throw unsafePart(entry, 'Workbook part holds a style the strict lexer cannot read');
      }
      assertNoFieldAfter(entry, bytes, at, hyperlinkIds.external);
      return;
    }
    const kind = markup.kind;
    switch (kind) {
      case 'start':
      case 'empty': {
        const nameStart = markup.nameStart;
        const nameEnd = markup.nameEnd;
        const opensStyle =
          kind === 'start' && isNameIn(bytes, localNameStart(bytes, markup), nameEnd, STYLES);
        const inScopeBefore = scopes.declarationsInScope;
        const prefixes = declareNamespaces(entry, scopes, bytes, markup, attributes);
        const declarations = scopes.declarationsInScope - inScopeBefore;
        assertSafeElement(entry, bytes, markup, attributes, scopes, hyperlinkIds);
        // A field, macro or script element was read through its end tag, now in `markup`.
        if (markup.kind !== 'start') {
          endUnopenedElement(scopes, prefixes, declarations);
          break;
        }
        if (opensStyle && !inStyle) style.level = scopes.depth;
        openElement(scopes, nameStart, nameEnd, prefixes, declarations);
        break;
      }
      case 'end':
        closeElement(scopes, bytes, markup);
        if (inStyle && !scopes.broken && scopes.depth === style.level) endStyle(entry, style);
        break;
      case 'opaque':
        if (isStylesheetInstruction(bytes, markup)) {
          throw unsafePart(entry, 'Workbook part holds a stylesheet instruction');
        }
        if (inStyle) addStyleCdata(bytes, markup, style);
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
      }
    }
    textStart = markup.end;
  }
  if (style.level === OUTSIDE_STYLE) return;
  addStyleText(entry, style, bytes.subarray(textStart));
  endStyle(entry, style);
}

/**
 * Rejects one XML part, whatever its name, that declares a DOCTYPE or ENTITY (any
 * case), references an entity other than the five predefined ones and numeric
 * character references, or holds an unsafe formula field, macro assignment, script,
 * active element, URL outside the package, style that loads a resource or stylesheet
 * instruction, or more than MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations in
 * scope at once (see the formula field header). A hyperlink's `location` is taken for
 * a URL fragment only when its relationship ids are among those `hyperlinkIds` gives
 * only an external hyperlink, and no other element may name one it gives an external
 * hyperlink (those of this part, ExternalHyperlinkIds; none by default).
 * Throws SpreadsheetFileError('UNSAFE_CONTENT') naming `name`; a field refusal also
 * carries its reason (`unsafe-formula` or `unsafe-part`), the namespace refusal the cap.
 */
export function assertSafeXmlPart(
  name: string,
  bytes: Uint8Array,
  hyperlinkIds: WorksheetHyperlinkIds = NO_HYPERLINK_IDS,
): void {
  const xml = strFromU8(bytes);

  if (DTD_DECLARATION.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part declares a DOCTYPE or ENTITY', {
      entry: name,
    });
  }
  if (UNKNOWN_ENTITY_REFERENCE.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part references an unknown entity', {
      entry: name,
    });
  }
  assertSafeFields(name, bytes, hyperlinkIds);
}

/**
 * Whether the first markup of a part, at the '<' at `at`, leaves the part in UTF-8: it
 * is not a processing instruction, or the strict lexer reads it and it is not an XML
 * declaration, or it is an XML declaration (target exactly `xml`) that names no encoding
 * but UTF-8. A processing instruction the lexer refuses, or whose target is `xml` only
 * in another ASCII case, is one another reader may take for a declaration: false.
 */
function keepsUtf8(bytes: Uint8Array, at: number): boolean {
  if (bytes[at + 1] !== QUESTION) return true;
  const markup = createMarkup();
  try {
    scanMarkup(bytes, at, markup);
    if (!hasDeclarationTarget(bytes, markup)) return true;
    return isXmlDeclaration(bytes, markup) && declaresUtf8(bytes, markup, []);
  } catch (error) {
    if (error instanceof XmlLexError) return false;
    throw error;
  }
}

/**
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'part-encoding', entry }` unless
 * kept XML part `entry` is UTF-8 text (see the encoding header above): valid UTF-8, no
 * U+0000, and a first markup that keeps it in UTF-8 (keepsUtf8).
 */
function assertUtf8Text(entry: string, bytes: Uint8Array): void {
  if (!isUtf8(bytes) || bytes.includes(NUL)) {
    throw partEncodingError(entry, 'is not UTF-8 text');
  }
  const first = nextMarkup(bytes, 0);
  if (first !== -1 && !keepsUtf8(bytes, first)) {
    throw partEncodingError(
      entry,
      'declares an encoding other than UTF-8, or a declaration the scan cannot read',
    );
  }
}

/**
 * Checks entries, given by name and content, by what they hold: each is sorted by its
 * first bytes (assertEntryContentKind: CORRUPT_FILE `part-encoding` for XML the scans
 * cannot read or a name that promises XML it does not hold), and each XML entry must
 * be UTF-8 text (assertUtf8Text: CORRUPT_FILE `part-encoding`) and pass
 * assertSafeXmlPart (UNSAFE_CONTENT), checked for its encoding first, with the external
 * hyperlink ids `externalHyperlinks` gives its name (none by default). Every XML entry is
 * checked, whatever its name and whether a relationship names it or not: the export
 * hands each of them on unchanged.
 */
export function assertSafeXmlContent(
  entries: Iterable<readonly [string, Uint8Array]>,
  externalHyperlinks: ExternalHyperlinkIds = NO_EXTERNAL_HYPERLINKS,
): void {
  for (const [name, bytes] of entries) {
    const kind = entryContentKind(bytes);
    assertEntryContentKind(name, kind);
    if (kind !== 'xml') continue;
    assertUtf8Text(name, bytes);
    assertSafeXmlPart(name, bytes, externalHyperlinks.get(name) ?? NO_HYPERLINK_IDS);
  }
}
