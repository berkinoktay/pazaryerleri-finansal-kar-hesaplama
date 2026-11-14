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
// An entry that starts with a UTF-16 or UTF-32 byte order mark, or whose first '<' has
// a U+0000 byte right before or after it (UTF-16 or UTF-32 text without one), is XML
// the scans cannot read: CORRUPT_FILE `part-encoding`. So is an entry named `.xml`,
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
// The first bytes held until the byte order mark is read: the longest mark.
const BYTE_ORDER_MARK_LENGTH = 4;
const NO_BYTE = -1;

// Formula fields (spec section 2.1 item 7). In every XML part, whatever its root element
// and path, the gate reads every field Excel evaluates: the text of the
// FORMULA_ELEMENT_NAMES elements, the value of the FORMULA_ATTRIBUTE_NAMES attributes,
// and the value of the ELEMENT_FORMULA_ATTRIBUTE_NAMES attributes on their one element
// (a conditional format value object's `val`, a hyperlink's `location`, a camera tool's
// `cellRange`), local names compared ignoring their prefix and ASCII case (so a reader
// that ignores case finds no field the gate skipped). A hyperlink's `location` is a
// field only when the hyperlink has no relationship id (an `id` attribute whose prefix
// is bound to RELATIONSHIPS_NAMESPACE where it stands): with one, the hyperlink leads to
// the relationship's URL and Excel keeps that URL's #fragment in `location`
// (https://site/page#part: Target https://site/page, location `part`), which is no
// formula. Each field is decoded (the five
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
// The walk keeps the namespace declarations in scope (NamespaceScopes) in memory bounded
// by MAX_XMLNS_DECLARATIONS_PER_PART: it counts the open elements and keeps an entry
// only for an open element that declares namespaces, and a part with more declarations
// than that is refused with the error the reader parts get for it
// (tooManyNamespaceDeclarations). A binding counts only while every end tag that returns
// to the level of a declaring element names it, and no end tag at another level names an
// open declaring element; markup whose nesting the walk cannot follow leaves every `f` a
// field and every hyperlink `location` a formula.
// A macro assignment needs code the gate never accepts, so a non-empty
// MACRO_ATTRIBUTE_NAMES attribute or FmlaMacro element is refused (Excel writes
// `macro=""` on every shape), and an element of ACTIVE_ELEMENT_NAMES (an embedded
// object, a control, a web publishing item) is refused wherever it stands. So is a
// SCRIPT_ELEMENT_NAMES element (a VML control's script) that holds anything but white
// space.
// A URL_ATTRIBUTE_NAMES attribute (`src` or `href`, any prefix: VML's v:imagedata@src,
// @o:href, v:fill@src, a shape's href) names a resource outside the relationships, so
// its decoded value must be relative: one that starts, past the C0 controls and spaces
// a URL parser drops, with a URI scheme (an ASCII letter, then letters, digits, '+',
// '-' or '.', then ':'; the drive letter C: is one), a drive letter written C|, or '//',
// or that holds a backslash anywhere, is refused with UNSAFE_CONTENT `unsafe-part`.
// Where the strict lexer refuses markup that a lenient or a non-ASCII reading accepts,
// the walk cannot tell where the fields are from there on, so the part is refused when
// anything after that point could open a field, macro, script or active element or an
// element with a field attribute of its own, or name a field, macro or URL attribute.
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
const URL_ATTRIBUTE_NAMES: readonly string[] = ['src', 'href'];
const ACTIVE_ELEMENT_NAMES: readonly string[] = [
  'oleObject',
  'oleObjects',
  'control',
  'controls',
  'webPublishItem',
  'webPublishObject',
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
  /** Its name: bytes [nameStart, nameEnd) of the part, and their text. */
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly name: string;
  /** The prefixes it bound (DEFAULT_NAMESPACE_KEY for the default namespace). */
  readonly prefixes: readonly string[];
}

/**
 * The namespace declarations in scope while one part is walked, in memory bounded by
 * MAX_XMLNS_DECLARATIONS_PER_PART (see the header). A declaration is compared byte for
 * byte: one written with a reference names another namespace. A prefix declared twice
 * on one element names a known namespace only when both declarations name it.
 */
interface NamespaceScopes {
  /** Per prefix (DEFAULT_NAMESPACE_KEY for the default namespace), its bindings, innermost last. */
  readonly bindings: Map<string, NamespaceBinding[]>;
  /** The open elements that declare namespaces, innermost last. */
  readonly declaring: DeclaringElement[];
  /** How many open declaring elements have each name, and each name length in bytes. */
  readonly declaringNames: Map<string, number>;
  readonly declaringNameLengths: Map<number, number>;
  /** How many elements are open. */
  depth: number;
  /** The namespace declarations of the part read so far. */
  declarations: number;
  /** The walk lost the nesting of the part: no binding counts. */
  broken: boolean;
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

// Code units of the URL attribute reading (isAbsoluteUrl).
const BACKSLASH_TEXT = '\\';
// What a URL parser removes wherever it stands: ASCII tab and line breaks.
const URL_REMOVED: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);
// The punctuation a URI scheme may hold after its first letter: '+', '-' and '.'.
const URL_SCHEME_PUNCTUATION: ReadonlySet<number> = new Set([0x2b, 0x2d, 0x2e]);
// What follows the letter of a drive letter besides ':' (C|/x is C:/x to a URL parser).
const DRIVE_LETTER_BAR = 0x7c;
const LOWER_Z = 0x7a;

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
const MACRO_ATTRIBUTES = nameSet(MACRO_ATTRIBUTE_NAMES);
const MACRO_ELEMENTS = nameSet(MACRO_ELEMENT_NAMES);
const SCRIPT_ELEMENTS = nameSet(SCRIPT_ELEMENT_NAMES);
const URL_ATTRIBUTES = nameSet(URL_ATTRIBUTE_NAMES);
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

/** Reads the held first bytes: a UTF-16 or UTF-32 mark decides, a UTF-8 one is skipped. */
function readHead(sniff: EntryContentSniff): void {
  sniff.headRead = true;
  if (OTHER_BYTE_ORDER_MARKS.some((mark) => startsWithBytes(sniff.head, mark))) {
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
    throw partEncodingError(name, 'is UTF-16 or UTF-32 text, which the scans cannot read');
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

function isAsciiLetter(code: number): boolean {
  const lower = foldAsciiByte(code) ?? NOT_A_DIGIT;
  return lower >= LOWER_A && lower <= LOWER_Z;
}

/** What a URI scheme holds after its first letter: ASCII letters, digits, '+', '-' and '.'. */
function isSchemeCharacter(code: number): boolean {
  return (
    isAsciiLetter(code) ||
    (code >= DIGIT_ZERO && code <= DIGIT_NINE) ||
    URL_SCHEME_PUNCTUATION.has(code)
  );
}

/** The index of the first code unit of `value` from `at` that a URL parser keeps (not URL_REMOVED). */
function keptUrlIndex(value: string, at: number): number {
  let index = at;
  while (index < value.length && URL_REMOVED.has(value.charCodeAt(index))) index += 1;
  return index;
}

/**
 * Whether the decoded URL attribute text `value` names something outside the package
 * (see the header): a backslash anywhere, or, past the C0 controls and spaces a URL
 * parser drops from its front, a start of '//', a drive letter written C|, or a URI
 * scheme up to its ':' (C: among them). URL_REMOVED code units are skipped. One pass.
 */
function isAbsoluteUrl(value: string): boolean {
  if (value.includes(BACKSLASH_TEXT)) return true;
  let start = 0;
  while (start < value.length && value.charCodeAt(start) <= SPACE) start += 1;
  if (start >= value.length) return false;
  const first = value.charCodeAt(start);
  const next = keptUrlIndex(value, start + 1);
  if (first === SLASH) return next < value.length && value.charCodeAt(next) === SLASH;
  if (!isAsciiLetter(first)) return false;
  if (next < value.length && value.charCodeAt(next) === DRIVE_LETTER_BAR) return true;
  for (let at = next; at < value.length; at = keptUrlIndex(value, at + 1)) {
    const code = value.charCodeAt(at);
    if (code === COLON) return true;
    if (!isSchemeCharacter(code)) return false;
  }
  return false;
}

/** Decodes URL attribute value bytes `raw`: a relative URL, or UNSAFE_CONTENT `unsafe-part`. */
function assertRelativeUrl(entry: string, raw: Uint8Array): void {
  const text = decodeXmlText(raw);
  if (text === null || isAbsoluteUrl(text)) {
    throw unsafePart(entry, 'Workbook part links to a resource outside the package');
  }
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
 * URL attribute is relative.
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
  if (isNameIn(bytes, localStart, nameEnd, URL_ATTRIBUTES)) {
    assertRelativeUrl(entry, bytes.subarray(valueStart, valueEnd));
    return;
  }
  const field =
    isNameIn(bytes, localStart, nameEnd, FORMULA_ATTRIBUTES) ||
    (elementField !== null && isNameIn(bytes, localStart, nameEnd, elementField));
  if (!field) return;
  const quoted = isNameIn(bytes, localStart, nameEnd, PIVOT_FORMULA_ATTRIBUTE)
    ? formulaQuotes
    : 'sheet-name';
  assertSafeFormulaField(entry, bytes.subarray(valueStart, valueEnd), quoted);
}

/** The field attribute of its own the element whose local name is bytes [start, end) carries, or null. */
function elementFormulaAttribute(bytes: Uint8Array, start: number, end: number): NameSet | null {
  for (const [element, attribute] of ELEMENT_FORMULA_ATTRIBUTES) {
    if (isNameIn(bytes, start, end, element)) return attribute;
  }
  return null;
}

/**
 * Checks the start or empty tag scanned into `markup` with its `attributes` (see the
 * formula field header): no active element, every field attribute safe (a hyperlink's
 * `location` only when it has no relationship id by `scopes`), and, for a start tag of
 * a field element outside the OMML namespace (`scopes`), its content up to its own end
 * tag (left in `markup`; assertSafeFieldContent), empty for a macro element, white
 * space only for a script element.
 */
function assertSafeElement(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  scopes: NamespaceScopes,
): void {
  const localStart = localNameStart(bytes, markup);
  const localEnd = markup.nameEnd;
  if (isNameIn(bytes, localStart, localEnd, ACTIVE_ELEMENTS)) {
    throw unsafePart(
      entry,
      'Workbook part holds an embedded object, a control or a web publishing item',
    );
  }
  const urlFragment =
    isNameIn(bytes, localStart, localEnd, URL_FRAGMENT_ELEMENTS) &&
    hasRelationshipId(scopes, bytes, markup, attributes);
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
    declaringNames: new Map(),
    declaringNameLengths: new Map(),
    depth: 0,
    declarations: 0,
    broken: false,
  };
}

/** Adds `delta` to the count of `key` in `counts`, dropping a count that reaches zero. */
function addCount<Key>(counts: Map<Key, number>, key: Key, delta: number): void {
  const count = (counts.get(key) ?? 0) + delta;
  if (count === 0) counts.delete(key);
  else counts.set(key, count);
}

/** The namespace the declaration value bytes [start, end) name. */
function knownNamespace(bytes: Uint8Array, start: number, end: number): KnownNamespace {
  for (const [uri, namespace] of KNOWN_NAMESPACES) {
    if (bytesEqualAscii(bytes, start, end, uri)) return namespace;
  }
  return 'other';
}

/**
 * Counts the namespace declarations of the start or empty tag scanned into `markup`
 * against MAX_XMLNS_DECLARATIONS_PER_PART for part `entry` (tooManyNamespaceDeclarations
 * past it) and, while bindings count, binds them in `scopes` at the current level. The
 * prefixes it bound (to release with releaseNamespaces), or null for none.
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
    scopes.declarations += 1;
    if (scopes.declarations > MAX_XMLNS_DECLARATIONS_PER_PART) {
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

/** Removes the bindings of `prefixes`, the innermost of each, from `scopes`. */
function releaseNamespaces(scopes: NamespaceScopes, prefixes: readonly string[]): void {
  for (const key of prefixes) scopes.bindings.get(key)?.pop();
}

/**
 * Opens the element whose start tag names bytes [nameStart, nameEnd), which bound
 * `prefixes`: one level deeper, and an entry when it declared namespaces.
 */
function openElement(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  nameStart: number,
  nameEnd: number,
  prefixes: readonly string[] | null,
): void {
  if (scopes.broken) return;
  if (prefixes !== null) {
    const name = NAME_DECODER.decode(bytes.subarray(nameStart, nameEnd));
    scopes.declaring.push({ level: scopes.depth, nameStart, nameEnd, name, prefixes });
    addCount(scopes.declaringNames, name, 1);
    addCount(scopes.declaringNameLengths, nameEnd - nameStart, 1);
  }
  scopes.depth += 1;
}

/**
 * Whether the end tag scanned into `markup` names an open declaring element. One lookup:
 * the name is decoded only when an open declaring element has its length.
 */
function namesDeclaringElement(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
): boolean {
  if (!scopes.declaringNameLengths.has(markup.nameEnd - markup.nameStart)) return false;
  const name = NAME_DECODER.decode(bytes.subarray(markup.nameStart, markup.nameEnd));
  return scopes.declaringNames.has(name);
}

/**
 * Closes the innermost open element with the end tag scanned into `markup`. Back at the
 * level of a declaring element, the end tag must name it, and releases its bindings;
 * at any other level it must name no open declaring element (a reader that recovers
 * from bad nesting would close that one there). Otherwise, or with no element open, no
 * binding counts from there on.
 */
function closeElement(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): void {
  if (scopes.broken) return;
  if (scopes.depth === 0) {
    scopes.broken = true;
    return;
  }
  scopes.depth -= 1;
  const innermost = scopes.declaring.at(-1);
  if (innermost === undefined || innermost.level !== scopes.depth) {
    if (namesDeclaringElement(scopes, bytes, markup)) scopes.broken = true;
    return;
  }
  if (!closesElement(bytes, markup, innermost.nameStart, innermost.nameEnd)) {
    scopes.broken = true;
    return;
  }
  scopes.declaring.pop();
  addCount(scopes.declaringNames, innermost.name, -1);
  addCount(scopes.declaringNameLengths, innermost.nameEnd - innermost.nameStart, -1);
  releaseNamespaces(scopes, innermost.prefixes);
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
 * Whether the tag scanned into `markup` has a relationship id: a non-empty attribute
 * whose local name is exactly RELATIONSHIP_ID_ATTRIBUTE and whose prefix is bound to
 * RELATIONSHIPS_NAMESPACE by `scopes`.
 */
function hasRelationshipId(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): boolean {
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    const candidate =
      localStart > nameStart &&
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_START) !==
        attributeField(attributes, attribute, ATTRIBUTE_VALUE_END) &&
      bytesEqualAscii(bytes, localStart, nameEnd, RELATIONSHIP_ID_ATTRIBUTE);
    if (!candidate) continue;
    const key = NAME_DECODER.decode(bytes.subarray(nameStart, localStart - 1));
    if (boundNamespace(scopes, key) === 'relationships') return true;
  }
  return false;
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
 * reader that stops at U+0080 or a non-ASCII letter reads, is one), or any run of name
 * bytes is a field, macro or URL attribute name. Linear: every loose name stops before
 * the next '<', every run of name bytes is read once.
 */
function assertNoFieldAfter(entry: string, bytes: Uint8Array, from: number): void {
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
    if (isNameIn(bytes, at, end, URL_ATTRIBUTES)) {
      throw unsafePart(entry, 'Workbook part holds a link the strict lexer cannot read');
    }
    at = end;
  }
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason, entry }` when XML part `entry`
 * holds a formula field that fails the scan, a macro assignment or a script
 * (`unsafe-formula`), an active element or a URL outside the package (`unsafe-part`),
 * or, past markup the strict lexer refuses, anything that could be one (see the formula
 * field header); UNSAFE_CONTENT `{ entry, cap }` when it holds more than
 * MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations. Every markup of the part is
 * read, the namespace declarations in scope kept on the way.
 */
function assertSafeFields(entry: string, bytes: Uint8Array): void {
  const markup = createMarkup();
  const attributes: number[] = [];
  const scopes = createNamespaceScopes();
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
    if (!lexes(bytes, at, markup, attributes)) {
      assertNoFieldAfter(entry, bytes, at);
      return;
    }
    const kind = markup.kind;
    switch (kind) {
      case 'start':
      case 'empty': {
        const nameStart = markup.nameStart;
        const nameEnd = markup.nameEnd;
        const prefixes = declareNamespaces(entry, scopes, bytes, markup, attributes);
        assertSafeElement(entry, bytes, markup, attributes, scopes);
        // A field, macro or script element was read through its end tag, now in `markup`.
        if (markup.kind === 'start') openElement(scopes, bytes, nameStart, nameEnd, prefixes);
        else if (prefixes !== null) releaseNamespaces(scopes, prefixes);
        break;
      }
      case 'end':
        closeElement(scopes, bytes, markup);
        break;
      case 'opaque':
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
      }
    }
  }
}

/**
 * Rejects one XML part, whatever its name, that declares a DOCTYPE or ENTITY (any
 * case), references an entity other than the five predefined ones and numeric
 * character references, or holds an unsafe formula field, macro assignment, script,
 * active element or URL outside the package, or more than
 * MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations (see the formula field header).
 * Throws SpreadsheetFileError('UNSAFE_CONTENT') naming `name`; a field refusal also
 * carries its reason (`unsafe-formula` or `unsafe-part`), the namespace refusal the cap.
 */
export function assertSafeXmlPart(name: string, bytes: Uint8Array): void {
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
  assertSafeFields(name, bytes);
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
 * assertSafeXmlPart (UNSAFE_CONTENT), checked for its encoding first. Every XML entry is
 * checked, whatever its name and whether a relationship names it or not: the export
 * hands each of them on unchanged.
 */
export function assertSafeXmlContent(entries: Iterable<readonly [string, Uint8Array]>): void {
  for (const [name, bytes] of entries) {
    const kind = entryContentKind(bytes);
    assertEntryContentKind(name, kind);
    if (kind !== 'xml') continue;
    assertUtf8Text(name, bytes);
    assertSafeXmlPart(name, bytes);
  }
}
