// Strict byte lexer of the export patch path: reads one markup at a time, as byte
// offsets into a worksheet part, and accepts only a strict subset of XML.
//
// The reader (xmldom) and the patcher must see the same cells. Every leniency of
// xmldom lives in start-tag parsing: it takes U+0080 and any byte below 0x20 as tag
// whitespace, an unquoted or valueless attribute, two attributes with no space
// between them, a space between '/' and '>'. A document whose every tag is
// well-formed character by character has one reading, so the caller runs this lexer
// over EVERY markup of the part, not only the ones it uses, and refuses the part at
// the first XmlLexError.
//
// Linear: every delimiter search moves forward from where the construct started and
// is never repeated from an earlier offset, a tag is walked once, and a scan
// allocates nothing (the attribute list is the caller's, reused across calls).

/** Package-internal: callers turn it into a SpreadsheetFileError with their own code. */
export class XmlLexError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'XmlLexError';
    this.offset = offset;
  }
}

export type XmlMarkupKind = 'start' | 'empty' | 'end' | 'opaque';

/** One markup, as offsets into the part. Reused across calls: no object per tag. */
export interface XmlMarkup {
  kind: XmlMarkupKind;
  /** The '<'. */
  start: number;
  /** Just past the closing '>'. */
  end: number;
  /** Qualified name; the target for a processing instruction; `start` for a comment or CDATA. */
  nameStart: number;
  nameEnd: number;
}

/** Offsets written per attribute: nameStart, nameEnd, valueStart, valueEnd (the value without its quotes). */
export const ATTRIBUTE_FIELDS = 4;

// XML's S production, and nothing else: xmldom also takes U+0080 and every byte
// below 0x20, which this lexer refuses.
const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

const TAG_OPEN = 0x3c; // '<'
const TAG_CLOSE = 0x3e; // '>'
const SLASH = 0x2f; // '/': opens an end tag after '<', closes an empty tag before '>'
const BANG = 0x21; // '!': opens a comment, CDATA section or DTD declaration after '<'
const QUESTION = 0x3f; // '?': opens a processing instruction after '<'
const EQUALS = 0x3d;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const COLON = 0x3a;
const UNDERSCORE = 0x5f;
const HYPHEN = 0x2d;
const PERIOD = 0x2e;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const MAX_ASCII = 0x7f;

const END_TAG_OPEN = '</';
const PI_OPEN = '<?';
const EMPTY_TAG_CLOSE = '/>';
const PI_CLOSE = '?>';
const COMMENT_OPEN = '<!--';
// The first '--' inside a comment must be its close: '--' is not allowed in a body.
const COMMENT_DASHES = '--';
const COMMENT_CLOSE = '-->';
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';

export function createMarkup(): XmlMarkup {
  return { kind: 'opaque', start: 0, end: 0, nameStart: 0, nameEnd: 0 };
}

/** Offset of the next '<' at or after `from`, or -1. */
export function nextMarkup(bytes: Uint8Array, from: number): number {
  return bytes.indexOf(TAG_OPEN, from);
}

/** Whether bytes [start, end) are exactly the ASCII string `text`. */
export function bytesEqualAscii(
  bytes: Uint8Array,
  start: number,
  end: number,
  text: string,
): boolean {
  if (start < 0 || end > bytes.length || end - start !== text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > MAX_ASCII || bytes[start + index] !== code) return false;
  }
  return true;
}

/** Offset where the local name starts: after the prefix colon, or `nameStart`. */
export function localNameStart(bytes: Uint8Array, markup: XmlMarkup): number {
  // Bounded by the name: an unbounded indexOf would run past it into the part.
  for (let at = markup.nameStart; at < markup.nameEnd; at += 1) {
    if (bytes[at] === COLON) return at + 1;
  }
  return markup.nameStart;
}

function isWhitespace(byte: number | undefined): boolean {
  return byte === SPACE || byte === TAB || byte === LF || byte === CR;
}

function isNameStartByte(byte: number | undefined): boolean {
  if (byte === undefined) return false;
  return (
    (byte >= UPPER_A && byte <= UPPER_Z) ||
    (byte >= LOWER_A && byte <= LOWER_Z) ||
    byte === UNDERSCORE
  );
}

function isNameByte(byte: number | undefined): boolean {
  if (byte === undefined) return false;
  return (
    isNameStartByte(byte) ||
    (byte >= DIGIT_ZERO && byte <= DIGIT_NINE) ||
    byte === HYPHEN ||
    byte === PERIOD
  );
}

function skipWhitespace(bytes: Uint8Array, from: number): number {
  let at = from;
  while (isWhitespace(bytes[at])) at += 1;
  return at;
}

/**
 * Offset of the first `pattern` (ASCII) at or after `from`, or -1. One forward
 * search: each offset is a candidate at most once and costs at most
 * `pattern.length` byte compares.
 */
function indexOfAscii(bytes: Uint8Array, from: number, pattern: string): number {
  const first = pattern.charCodeAt(0);
  let at = bytes.indexOf(first, from);
  while (at !== -1) {
    if (bytesEqualAscii(bytes, at, at + pattern.length, pattern)) return at;
    at = bytes.indexOf(first, at + 1);
  }
  return -1;
}

/**
 * Offset just past the name that starts at `from`. A name is ASCII: a letter or '_',
 * then letters, digits, '_', '-', '.', and at most one ':' that is neither first nor
 * last. The name ends at the first other byte; the caller checks what that byte is.
 */
function scanName(bytes: Uint8Array, from: number): number {
  if (!isNameStartByte(bytes[from])) throw new XmlLexError('Expected a name', from);
  let at = from + 1;
  let colonSeen = false;
  for (;;) {
    const byte = bytes[at];
    if (isNameByte(byte)) {
      at += 1;
      continue;
    }
    if (byte !== COLON) return at;
    if (colonSeen) throw new XmlLexError('Name has more than one colon', at);
    if (!isNameByte(bytes[at + 1])) {
      throw new XmlLexError('Name colon is not followed by a name byte', at);
    }
    colonSeen = true;
    at += 1;
  }
}

/**
 * Offset of the quote that closes the value starting at `from`. The value holds no
 * '<' and must close before `limit`.
 */
function scanQuotedValue(bytes: Uint8Array, from: number, limit: number, quote: number): number {
  for (let at = from; at < limit; at += 1) {
    const byte = bytes[at];
    if (byte === quote) return at;
    if (byte === TAG_OPEN) throw new XmlLexError('Attribute value holds a "<"', at);
  }
  throw new XmlLexError('Attribute value is not closed', from);
}

/**
 * Reads one attribute whose name starts at `from`: name, S*, '=', S*, a quoted value.
 * Appends its four offsets to `attributes` when given; returns the offset just past
 * the closing quote. `limit` bounds the value (the end of the bytes, or the '?>' of
 * an XML declaration).
 */
function scanAttribute(
  bytes: Uint8Array,
  from: number,
  limit: number,
  attributes: number[] | undefined,
): number {
  const nameEnd = scanName(bytes, from);
  const equals = skipWhitespace(bytes, nameEnd);
  if (bytes[equals] !== EQUALS) throw new XmlLexError('Attribute has no value', equals);
  const open = skipWhitespace(bytes, equals + 1);
  const quote = bytes[open];
  if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) {
    throw new XmlLexError('Attribute value is not quoted', open);
  }
  const valueStart = open + 1;
  const valueEnd = scanQuotedValue(bytes, valueStart, limit, quote);
  attributes?.push(from, nameEnd, valueStart, valueEnd);
  return valueEnd + 1;
}

function setMarkup(
  into: XmlMarkup,
  kind: XmlMarkupKind,
  start: number,
  end: number,
  nameStart: number,
  nameEnd: number,
): void {
  into.kind = kind;
  into.start = start;
  into.end = end;
  into.nameStart = nameStart;
  into.nameEnd = nameEnd;
}

/** `<` name, then (S+ attribute)*, S*, then '>' or '/>'. */
function scanElementTag(
  bytes: Uint8Array,
  at: number,
  into: XmlMarkup,
  attributes: number[] | undefined,
): void {
  const nameStart = at + 1;
  const nameEnd = scanName(bytes, nameStart);
  let position = nameEnd;
  for (;;) {
    const next = skipWhitespace(bytes, position);
    const byte = bytes[next];
    if (byte === TAG_CLOSE) {
      setMarkup(into, 'start', at, next + 1, nameStart, nameEnd);
      return;
    }
    if (byte === SLASH) {
      if (bytes[next + 1] !== TAG_CLOSE) throw new XmlLexError('Expected ">" after "/"', next + 1);
      setMarkup(into, 'empty', at, next + EMPTY_TAG_CLOSE.length, nameStart, nameEnd);
      return;
    }
    if (byte === undefined) throw new XmlLexError('Tag is not closed', at);
    // An attribute must follow whitespace: '<c r="A1"s="1">' is refused here.
    if (next === position) throw new XmlLexError('Expected whitespace, ">" or "/>"', next);
    position = scanAttribute(bytes, next, bytes.length, attributes);
  }
}

/** `</` name S* `>`. */
function scanEndTag(bytes: Uint8Array, at: number, into: XmlMarkup): void {
  const nameStart = at + END_TAG_OPEN.length;
  const nameEnd = scanName(bytes, nameStart);
  const close = skipWhitespace(bytes, nameEnd);
  if (bytes[close] !== TAG_CLOSE) throw new XmlLexError('Expected ">" in an end tag', close);
  setMarkup(into, 'end', at, close + 1, nameStart, nameEnd);
}

/** `<!--`, then the first '--' after it must be followed by '>'. */
function scanComment(bytes: Uint8Array, at: number, into: XmlMarkup): void {
  const dashes = indexOfAscii(bytes, at + COMMENT_OPEN.length, COMMENT_DASHES);
  if (dashes === -1) throw new XmlLexError('Comment is not closed', at);
  if (bytes[dashes + COMMENT_DASHES.length] !== TAG_CLOSE) {
    throw new XmlLexError('Comment holds "--"', dashes);
  }
  setMarkup(into, 'opaque', at, dashes + COMMENT_CLOSE.length, at, at);
}

/** `<![CDATA[` up to the first ']]>'. */
function scanCdata(bytes: Uint8Array, at: number, into: XmlMarkup): void {
  const close = indexOfAscii(bytes, at + CDATA_OPEN.length, CDATA_CLOSE);
  if (close === -1) throw new XmlLexError('CDATA section is not closed', at);
  setMarkup(into, 'opaque', at, close + CDATA_CLOSE.length, at, at);
}

/** A comment or a CDATA section; any other '<!' (DOCTYPE, ENTITY) is refused. */
function scanBangMarkup(bytes: Uint8Array, at: number, into: XmlMarkup): void {
  if (bytesEqualAscii(bytes, at, at + COMMENT_OPEN.length, COMMENT_OPEN)) {
    scanComment(bytes, at, into);
    return;
  }
  if (bytesEqualAscii(bytes, at, at + CDATA_OPEN.length, CDATA_OPEN)) {
    scanCdata(bytes, at, into);
    return;
  }
  throw new XmlLexError('Declaration other than a comment or CDATA', at);
}

/**
 * `<?` name, up to the first '?>'. The target is followed by whitespace or by the
 * '?>' itself, as XML's PI production requires.
 */
function scanProcessingInstruction(bytes: Uint8Array, at: number, into: XmlMarkup): void {
  const nameStart = at + PI_OPEN.length;
  const nameEnd = scanName(bytes, nameStart);
  const close = indexOfAscii(bytes, nameEnd, PI_CLOSE);
  if (close === -1) throw new XmlLexError('Processing instruction is not closed', at);
  if (close !== nameEnd && !isWhitespace(bytes[nameEnd])) {
    throw new XmlLexError('Expected whitespace after a processing instruction target', nameEnd);
  }
  setMarkup(into, 'opaque', at, close + PI_CLOSE.length, nameStart, nameEnd);
}

/** Reads the markup at the '<' at `at` into `into`. With `attributes`, clears it and fills it for a start or empty tag. */
export function scanMarkup(
  bytes: Uint8Array,
  at: number,
  into: XmlMarkup,
  attributes?: number[],
): void {
  if (attributes !== undefined) attributes.length = 0;
  if (bytes[at] !== TAG_OPEN) throw new XmlLexError('Expected "<"', at);
  const next = bytes[at + 1];
  if (next === SLASH) {
    scanEndTag(bytes, at, into);
    return;
  }
  if (next === BANG) {
    scanBangMarkup(bytes, at, into);
    return;
  }
  if (next === QUESTION) {
    scanProcessingInstruction(bytes, at, into);
    return;
  }
  scanElementTag(bytes, at, into, attributes);
}

/** The pseudo-attributes of an XML declaration already scanned into `markup`, by the attribute grammar. */
export function scanDeclaration(bytes: Uint8Array, markup: XmlMarkup, attributes: number[]): void {
  attributes.length = 0;
  if (markup.kind !== 'opaque' || bytes[markup.start + 1] !== QUESTION) {
    throw new XmlLexError('Expected a processing instruction', markup.start);
  }
  // The '?' of the closing '?>': no name, whitespace or value can run past it.
  const limit = markup.end - PI_CLOSE.length;
  let position = markup.nameEnd;
  for (;;) {
    const next = skipWhitespace(bytes, position);
    if (next === limit) return;
    if (next === position) {
      throw new XmlLexError('Expected whitespace before a pseudo-attribute', next);
    }
    position = scanAttribute(bytes, next, limit, attributes);
  }
}
