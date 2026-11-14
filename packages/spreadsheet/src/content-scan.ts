import { isUtf8 } from 'node:buffer';

import { strFromU8 } from 'fflate';
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
// that ignores case finds no field the gate skipped). Each field is decoded (the five
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
// The walk keeps the namespace declarations in scope (NamespaceScopes); a binding counts
// only while every end tag closes the innermost open element, so markup whose nesting
// the walk cannot follow leaves every `f` a field.
// A macro assignment needs code the gate never accepts, so a non-empty
// MACRO_ATTRIBUTE_NAMES attribute or FmlaMacro element is refused (Excel writes
// `macro=""` on every shape), and an element of ACTIVE_ELEMENT_NAMES (an embedded
// object, a control, a web publishing item) is refused wherever it stands.
// Where the strict lexer refuses markup that a lenient or a non-ASCII reading accepts,
// the walk cannot tell where the fields are from there on, so the part is refused when
// anything after that point could open a field element, an element with a field
// attribute of its own, or name a field attribute.
// Every pass is linear in the part; the formula fields are read without a regular
// expression (formula-scan.ts).
const FORMULA_ELEMENT_NAMES: readonly string[] = [
  'f',
  'formula',
  'formula1',
  'formula2',
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
const MACRO_ATTRIBUTE_NAMES: readonly string[] = ['macro', 'fmlaMacro'];
const MACRO_ELEMENT_NAMES: readonly string[] = ['FmlaMacro'];
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
// The key of the default namespace among the prefixes of NamespaceScopes.
const DEFAULT_NAMESPACE_KEY = '';
// Numbers NamespaceScopes.open holds per open element: name start, name end, and
// whether it declared namespaces (DECLARED or NOT_DECLARED).
const DECLARED = 1;
const NOT_DECLARED = 0;

/** Lower-case ASCII names, by length. */
type NameSet = ReadonlyMap<number, readonly string[]>;

/** One namespace binding: the element that declared it and whether it names OMML_NAMESPACE. */
interface NamespaceBinding {
  readonly element: number;
  omml: boolean;
}

/**
 * The namespace declarations in scope while one part is walked. A declaration is
 * compared byte for byte: one written with a reference names another namespace. A
 * prefix declared twice on one element names OMML only when both declarations do.
 */
interface NamespaceScopes {
  /** Per prefix (DEFAULT_NAMESPACE_KEY for the default namespace), its bindings, innermost last. */
  readonly bindings: Map<string, NamespaceBinding[]>;
  /** The prefixes each declaring element in scope bound, innermost last. */
  readonly declared: string[][];
  /** The open elements, outermost first: name start, name end, DECLARED or NOT_DECLARED. */
  readonly open: number[];
  /** Serial number of the next element that declares namespaces. */
  nextElement: number;
  /** An end tag closed something else than the innermost open element: no binding counts. */
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
const MACRO_ATTRIBUTES = nameSet(MACRO_ATTRIBUTE_NAMES);
const MACRO_ELEMENTS = nameSet(MACRO_ELEMENT_NAMES);
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
 * `formula` attribute read with quoted sections as `formulaQuotes`; a macro is empty.
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
 * formula field header): no active element, every field attribute safe, and, for a
 * start tag of a field element outside the OMML namespace (`scopes`), its content up to
 * its own end tag (left in `markup`; assertSafeFieldContent), empty for a macro element.
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
  const elementField = elementFormulaAttribute(bytes, localStart, localEnd);
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
  if (!isNameIn(bytes, localStart, localEnd, FORMULA_ELEMENTS)) return;
  if (inOmmlNamespace(scopes, bytes, markup)) return;
  assertSafeFieldContent(entry, bytes, markup, attributes);
}

function createNamespaceScopes(): NamespaceScopes {
  return { bindings: new Map(), declared: [], open: [], nextElement: 0, broken: false };
}

/**
 * Adds the namespace declarations of the start or empty tag scanned into `markup` to
 * `scopes`; whether it declared any (they must be released with releaseNamespaces).
 */
function declareNamespaces(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): boolean {
  if (scopes.broken) return false;
  const element = scopes.nextElement;
  // Allocated at the first declaration only: most elements declare none.
  let prefixes: string[] | null = null;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (!isNamespaceDeclaration(bytes, nameStart, nameEnd)) continue;
    const key =
      nameEnd === nameStart + NAMESPACE_DECLARATION.length
        ? DEFAULT_NAMESPACE_KEY
        : NAME_DECODER.decode(
            bytes.subarray(nameStart + NAMESPACE_DECLARATION_PREFIX.length, nameEnd),
          );
    const omml = bytesEqualAscii(
      bytes,
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
      OMML_NAMESPACE,
    );
    const stack = scopes.bindings.get(key) ?? [];
    scopes.bindings.set(key, stack);
    const innermost = stack.at(-1);
    if (innermost !== undefined && innermost.element === element) {
      innermost.omml = innermost.omml && omml;
      continue;
    }
    stack.push({ element, omml });
    prefixes ??= [];
    prefixes.push(key);
  }
  if (prefixes === null) return false;
  scopes.nextElement += 1;
  scopes.declared.push(prefixes);
  return true;
}

/** Removes the bindings of the innermost declaring element from `scopes`. */
function releaseNamespaces(scopes: NamespaceScopes): void {
  const prefixes = scopes.declared.pop() ?? [];
  for (const key of prefixes) scopes.bindings.get(key)?.pop();
}

/** Makes the start tag at bytes [nameStart, nameEnd) the innermost open element. */
function openElement(
  scopes: NamespaceScopes,
  nameStart: number,
  nameEnd: number,
  declared: boolean,
): void {
  if (scopes.broken) return;
  scopes.open.push(nameStart, nameEnd, declared ? DECLARED : NOT_DECLARED);
}

/**
 * Closes the innermost open element with the end tag scanned into `markup`, releasing
 * its bindings; when the end tag names another element (or none is open), no binding
 * counts from there on.
 */
function closeElement(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): void {
  if (scopes.broken) return;
  const declared = scopes.open.pop();
  const nameEnd = scopes.open.pop();
  const nameStart = scopes.open.pop();
  if (
    declared === undefined ||
    nameEnd === undefined ||
    nameStart === undefined ||
    !closesElement(bytes, markup, nameStart, nameEnd)
  ) {
    scopes.broken = true;
    return;
  }
  if (declared === DECLARED) releaseNamespaces(scopes);
}

/** Whether the element scanned into `markup` is in OMML_NAMESPACE by the bindings of `scopes`. */
function inOmmlNamespace(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): boolean {
  if (scopes.broken) return false;
  const localStart = localNameStart(bytes, markup);
  const key =
    localStart === markup.nameStart
      ? DEFAULT_NAMESPACE_KEY
      : NAME_DECODER.decode(bytes.subarray(markup.nameStart, localStart - 1));
  return scopes.bindings.get(key)?.at(-1)?.omml === true;
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
 * there on could open a field, macro or active element or an element with a field
 * attribute of its own (the strict-name head of its loose local name, which a reader
 * that stops at U+0080 or a non-ASCII letter reads, is one), or any run of name bytes is
 * a field or macro attribute name. Linear: every loose name stops before the next '<',
 * every run of name bytes is read once.
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
      isNameIn(bytes, localStart, headEnd, MACRO_ELEMENTS)
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
    at = end;
  }
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason, entry }` when XML part `entry`
 * holds a formula field that fails the scan, a macro assignment (`unsafe-formula`) or an
 * active element (`unsafe-part`), or, past markup the strict lexer refuses, anything
 * that could be one (see the formula field header). Every markup of the part is read,
 * the namespace declarations in scope kept on the way.
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
        const declared = declareNamespaces(scopes, bytes, markup, attributes);
        assertSafeElement(entry, bytes, markup, attributes, scopes);
        // A field or macro element was read through its end tag, now in `markup`.
        if (markup.kind === 'start') openElement(scopes, nameStart, nameEnd, declared);
        else if (declared) releaseNamespaces(scopes);
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
 * character references, or holds an unsafe formula field, macro assignment or active
 * element (see the formula field header). Throws SpreadsheetFileError('UNSAFE_CONTENT')
 * naming `name`; a field refusal also carries its reason (`unsafe-formula` or
 * `unsafe-part`).
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
