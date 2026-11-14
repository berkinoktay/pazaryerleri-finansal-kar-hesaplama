import { MAX_FORMULA_TEXT_LENGTH } from './constants';

// The formula rule of the upload gate (spec section 2.1 item 7). The byte-preserving
// export hands every formula of a stored upload unchanged to whoever exports it, and a
// list of forbidden functions kept missing new names, prefixes and look-alike letters,
// so a formula may call only the built-in functions of SAFE_FORMULA_FUNCTIONS: pure math,
// text, logical, lookup and date functions that reach nothing outside the workbook.
//
// The text is a formula field already decoded from XML (content-scan.ts). It is read
// twice, unchanged and in its NFKC form (a reader that normalises sees full-width,
// circled or other compatibility letters in their ASCII form), and both readings must
// pass. Each reading is one hand-written forward pass over code points; no regular
// expression ever runs over the text or a run of it (a quantified Unicode class over a
// run of millions of letters exhausts V8's backtracking stack). A character class is
// only ever tested on one code point.
//
// The reading refuses:
//   - an `_xHHHH_` escape anywhere (OOXML's ST_Xstring, which Excel decodes on open);
//   - a Unicode format character (general category Cf) outside a string literal;
//   - a string literal ("..."; "" stands for one quote) or a quoted section ('...'; ''
//     stands for one apostrophe) that never closes. A quoted section is a sheet name:
//     inside it, any of [ ] \ / ? * is refused (Excel allows none of them in a sheet
//     name, so there they spell an external workbook or a path); the colon of a 3-D
//     reference stays allowed. In the formula of a pivot calculated field or item it is
//     a field name instead ('Fiyat/Adet'), read opaque: only its close and format
//     characters are checked (QuotedSection). There a '[' right after its closing
//     apostrophe opens an item selector ('Grup'[Elektronik], 'Grup'[-1]), read like a
//     structured reference;
//   - outside them: a '|' (a DDE link), a '\' (a path: \\host\share\x.xlsx!Name,
//     C:\temp\[x.xlsx]S!A1) unless it starts a name, a ']' that closes nothing, and a
//     '[' that does not follow a name character (a reference into another workbook),
//     unless it starts exactly `[0]!` followed by a name: Excel's "this workbook" in a
//     chart series bound to a defined name ([0]!SalesRange). A '\' starts a name (Excel
//     allows a defined or table name that starts with one, the old shortcut macro names
//     like \a) only when the code point before it is not a name character, ':' or '\'
//     and the one after it is a Unicode letter or '_';
//   - a structured reference (a '[' right after a name that starts with a Unicode letter
//     or '_', Table1[Fiyat]) that never closes; its brackets nest, an apostrophe escapes
//     the next character. A '[' right after any other name (1[1]S!A1) is a reference into
//     another workbook, and so is a name, or a '\', right after the ']' that closes a
//     structured reference or an item selector (Table1[x]Sheet1!A1: the [book]Sheet!
//     shape);
//   - a '(' right after ')', ']' or '}' (no white space between): a call of the result of
//     an expression, CHOOSE(1,WEBSERVICE)("x"). With white space between, ") (" is the
//     intersection operator and passes;
//   - a name that starts with `_XL` once the `_XLFN.` and `_XLWS.` prefixes of newer
//     functions are removed from its front (`_xludf.`, `_xleta.`, `_xlpm.`, `_xlop.`,
//     `_xlnm.` and any other internal prefix), except a name that starts with
//     `_XLCHART.` and is not called: the hidden defined names through which an Excel
//     2016+ chart (waterfall, histogram, treemap and the like) reads its data
//     (`<cx:f>_xlchart.v1.0</cx:f>`);
//   - a name followed, after optional white space, by '(' (a call) that is not in
//     SAFE_FORMULA_FUNCTIONS. A name without '(' is a reference or a defined name and
//     passes (Imports!A1, RTD:RTD, a bare CALL).
// A name is a maximal run of Unicode letters, combining marks, digits, '_' and '.',
// compared after NFKC normalisation and Unicode upper-casing. A text longer than
// MAX_FORMULA_TEXT_LENGTH is refused before it is read: Excel writes none, and the NFKC
// form of a long text can grow eighteenfold.

/**
 * Upper-case ASCII names of the built-in functions a formula may call, sorted: pure
 * functions without an effect outside the workbook. OFFSET and INDEX resolve a
 * reference inside the workbook, never text; so do ANCHORARRAY (the spill reference
 * D2#) and SINGLE (the implicit intersection @). Not here on purpose, among others:
 * WEBSERVICE, FILTERXML, ENCODEURL, IMAGE, RTD, CALL, REGISTER, REGISTER.ID, EXEC,
 * HYPERLINK, INDIRECT, CELL, INFO, STOCKHISTORY, TRANSLATE, DETECTLANGUAGE, PY,
 * COPILOT, DDE, SQL.REQUEST, LAMBDA, LET, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY,
 * ISOMITTED and every IMPORT* name.
 */
export const SAFE_FORMULA_FUNCTIONS: readonly string[] = [
  'ABS',
  'ADDRESS',
  'AGGREGATE',
  'ANCHORARRAY',
  'AND',
  'AVERAGE',
  'AVERAGEA',
  'AVERAGEIF',
  'AVERAGEIFS',
  'CEILING',
  'CEILING.MATH',
  'CEILING.PRECISE',
  'CHAR',
  'CHOOSE',
  'CHOOSECOLS',
  'CHOOSEROWS',
  'CLEAN',
  'CODE',
  'COLUMN',
  'COLUMNS',
  'COMBIN',
  'CONCAT',
  'CONCATENATE',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'COUNTIF',
  'COUNTIFS',
  'DATE',
  'DATEDIF',
  'DATEVALUE',
  'DAY',
  'DAYS',
  'DAYS360',
  'DOLLAR',
  'DROP',
  'EDATE',
  'EOMONTH',
  'EVEN',
  'EXACT',
  'EXP',
  'EXPAND',
  'FACT',
  'FALSE',
  'FILTER',
  'FIND',
  'FIXED',
  'FLOOR',
  'FLOOR.MATH',
  'FLOOR.PRECISE',
  'FORMULATEXT',
  'GCD',
  'HLOOKUP',
  'HOUR',
  'HSTACK',
  'IF',
  'IFERROR',
  'IFNA',
  'IFS',
  'INDEX',
  'INT',
  'ISBLANK',
  'ISERR',
  'ISERROR',
  'ISEVEN',
  'ISFORMULA',
  'ISLOGICAL',
  'ISNA',
  'ISNONTEXT',
  'ISNUMBER',
  'ISODD',
  'ISOWEEKNUM',
  'ISREF',
  'ISTEXT',
  'LARGE',
  'LCM',
  'LEFT',
  'LEN',
  'LN',
  'LOG',
  'LOG10',
  'LOOKUP',
  'LOWER',
  'MATCH',
  'MAX',
  'MAXA',
  'MAXIFS',
  'MEDIAN',
  'MID',
  'MIN',
  'MINA',
  'MINIFS',
  'MINUTE',
  'MOD',
  'MODE',
  'MODE.SNGL',
  'MONTH',
  'MROUND',
  'N',
  'NA',
  'NETWORKDAYS',
  'NETWORKDAYS.INTL',
  'NOT',
  'NOW',
  'NUMBERVALUE',
  'ODD',
  'OFFSET',
  'OR',
  'PERCENTILE',
  'PERCENTILE.EXC',
  'PERCENTILE.INC',
  'PI',
  'POWER',
  'PRODUCT',
  'PROPER',
  'QUARTILE',
  'QUARTILE.INC',
  'QUOTIENT',
  'RAND',
  'RANDARRAY',
  'RANDBETWEEN',
  'RANK',
  'RANK.EQ',
  'REPLACE',
  'REPT',
  'RIGHT',
  'ROUND',
  'ROUNDDOWN',
  'ROUNDUP',
  'ROW',
  'ROWS',
  'SEARCH',
  'SECOND',
  'SEQUENCE',
  'SIGN',
  'SINGLE',
  'SMALL',
  'SORT',
  'SORTBY',
  'SQRT',
  'STDEV',
  'STDEV.P',
  'STDEV.S',
  'SUBSTITUTE',
  'SUBTOTAL',
  'SUM',
  'SUMIF',
  'SUMIFS',
  'SUMPRODUCT',
  'SUMSQ',
  'SWITCH',
  'T',
  'TAKE',
  'TEXT',
  'TEXTAFTER',
  'TEXTBEFORE',
  'TEXTJOIN',
  'TEXTSPLIT',
  'TIME',
  'TOCOL',
  'TODAY',
  'TOROW',
  'TRANSPOSE',
  'TRIM',
  'TRUE',
  'TRUNC',
  'UNIQUE',
  'UPPER',
  'VALUE',
  'VAR',
  'VAR.P',
  'VAR.S',
  'VLOOKUP',
  'VSTACK',
  'WEEKDAY',
  'WEEKNUM',
  'WORKDAY',
  'WORKDAY.INTL',
  'WRAPCOLS',
  'WRAPROWS',
  'XLOOKUP',
  'XMATCH',
  'YEAR',
  'YEARFRAC',
];

const SAFE_FUNCTIONS: ReadonlySet<string> = new Set(SAFE_FORMULA_FUNCTIONS);

/**
 * What an apostrophe-quoted section of a formula names: a sheet (every formula field
 * but one), or a field of a pivot cache (the formula of a calculated field or item).
 */
export type QuotedSection = 'sheet-name' | 'field-name';

// Whether the characters no sheet name has (SHEET_NAME_FORBIDDEN) are refused inside a
// quoted section: a field name may hold them.
const CHECKS_SHEET_NAME_CHARACTERS: Readonly<Record<QuotedSection, boolean>> = {
  'sheet-name': true,
  'field-name': false,
};
// Whether a '[' right after the closing apostrophe of a quoted section opens an item
// selector: after a field name ('Grup'[Elektronik]); after a sheet name it is refused.
const OPENS_ITEM_SELECTOR: Readonly<Record<QuotedSection, boolean>> = {
  'sheet-name': false,
  'field-name': true,
};

// Prefixes Excel writes before a function newer than the file format; removed from the
// front of a name, repeatedly, before it is compared.
const FUNCTION_PREFIXES: readonly string[] = ['_XLFN.', '_XLWS.'];
// What every internal Excel prefix starts with; a name that still starts with it once
// FUNCTION_PREFIXES are gone is refused.
const INTERNAL_PREFIX_START = '_XL';
// The upper-cased start of the hidden defined names an Excel 2016+ chart reads its data
// through (_xlchart.v1.0); such a name passes when it is not called.
const CHART_DATA_NAME_START = '_XLCHART.';
const NORMAL_FORM = 'NFKC';

// UTF-16 code units (ASCII).
const QUOTE = 0x22; // '"': opens and closes a string literal, doubled inside one
const APOSTROPHE = 0x27; // "'": opens and closes a quoted sheet name; escapes in a structured reference
const CALL_OPEN = 0x28; // '('
const PARENTHESIS_CLOSE = 0x29; // ')'
const BRACE_CLOSE = 0x7d; // '}': closes an array constant
const DDE_BAR = 0x7c; // '|'
const BRACKET_OPEN = 0x5b; // '['
const BRACKET_CLOSE = 0x5d; // ']'
const BACKSLASH = 0x5c;
const COLON = 0x3a;
const SLASH = 0x2f;
const QUESTION_MARK = 0x3f;
const ASTERISK = 0x2a;
const UNDERSCORE = 0x5f;
const PERIOD = 0x2e;
const LOWER_X = 0x78;
const UPPER_X = 0x58;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const UPPER_A = 0x41;
const UPPER_F = 0x46;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_F = 0x66;
const LOWER_Z = 0x7a;
const SPACE = 0x20;
const TAB = 0x09;
const CARRIAGE_RETURN = 0x0d;
const MAX_ASCII = 0x7f;
const MAX_BMP = 0xffff;
const SURROGATE_PAIR_LENGTH = 2;

// Characters Excel allows in no sheet name; inside a quoted sheet name they spell an
// external workbook ('[1]Sheet'!A1) or a path ('\\host\share\x.xlsx'!S, 'http://h/x'!S).
const SHEET_NAME_FORBIDDEN: ReadonlySet<number> = new Set([
  BRACKET_OPEN,
  BRACKET_CLOSE,
  BACKSLASH,
  SLASH,
  QUESTION_MARK,
  ASTERISK,
]);
// What a '(' may not follow directly: the close of a parenthesised expression, of a
// structured reference and of an array constant.
const EXPRESSION_ENDS: ReadonlySet<number> = new Set([
  PARENTHESIS_CLOSE,
  BRACKET_CLOSE,
  BRACE_CLOSE,
]);
// Excel's "this workbook" before a defined name, the only '[' that may stand alone.
const THIS_WORKBOOK = '[0]!';
// `_x` + four hexadecimal digits + `_`: the hexadecimal digits start after the `_x`.
const XSTRING_DIGITS_OFFSET = 2;
const XSTRING_DIGITS = 4;
const XSTRING_CLOSE_OFFSET = XSTRING_DIGITS_OFFSET + XSTRING_DIGITS;
// A doubled delimiter inside a literal or a quoted sheet name is one character.
const DOUBLED_DELIMITER_LENGTH = 2;

// Unicode classes, each only ever tested on the one code point it is given.
const NAME_CHARACTER = /^[\p{L}\p{M}\p{N}]$/u;
const LETTER = /^\p{L}$/u;
const FORMAT_CHARACTER = /^\p{Cf}$/u;
const WHITE_SPACE = /^\p{White_Space}$/u;

/** A section end (the index just past it) or why the formula is refused. */
type SectionEnd = number | string;

/** The code point at `at` (a lone surrogate stands for itself). */
function codePointAt(text: string, at: number): number {
  return text.codePointAt(at) ?? 0;
}

function codePointLength(code: number): number {
  return code > MAX_BMP ? SURROGATE_PAIR_LENGTH : 1;
}

/** The code point that ends right before `at` (a lone surrogate stands for itself); `at` is past the start. */
function codePointBefore(text: string, at: number): number {
  if (at >= SURROGATE_PAIR_LENGTH) {
    const pair = codePointAt(text, at - SURROGATE_PAIR_LENGTH);
    if (pair > MAX_BMP) return pair;
  }
  return codePointAt(text, at - 1);
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= UPPER_A && code <= UPPER_Z) ||
    (code >= LOWER_A && code <= LOWER_Z) ||
    (code >= DIGIT_ZERO && code <= DIGIT_NINE)
  );
}

/** A Unicode letter, combining mark or digit, '_' or '.'. */
function isNameCharacter(code: number): boolean {
  if (code <= MAX_ASCII)
    return isAsciiLetterOrDigit(code) || code === UNDERSCORE || code === PERIOD;
  return NAME_CHARACTER.test(String.fromCodePoint(code));
}

/** What a table or defined name starts with: a Unicode letter or '_'. */
function isNameStart(code: number): boolean {
  if (code <= MAX_ASCII) {
    return (
      (code >= UPPER_A && code <= UPPER_Z) ||
      (code >= LOWER_A && code <= LOWER_Z) ||
      code === UNDERSCORE
    );
  }
  return LETTER.test(String.fromCodePoint(code));
}

/** A Unicode format character (general category Cf): none is ASCII. */
function isFormatCharacter(code: number): boolean {
  return code > MAX_ASCII && FORMAT_CHARACTER.test(String.fromCodePoint(code));
}

/** A code point with the Unicode White_Space property. */
function isWhiteSpace(code: number): boolean {
  if (code <= MAX_ASCII) return code === SPACE || (code >= TAB && code <= CARRIAGE_RETURN);
  return WHITE_SPACE.test(String.fromCodePoint(code));
}

function isHexDigit(code: number): boolean {
  return (
    (code >= DIGIT_ZERO && code <= DIGIT_NINE) ||
    (code >= UPPER_A && code <= UPPER_F) ||
    (code >= LOWER_A && code <= LOWER_F)
  );
}

/** Whether an `_xHHHH_` escape (any case) starts at the '_' at `at`. */
function isXstringEscapeAt(text: string, at: number): boolean {
  const x = text.charCodeAt(at + 1);
  if (x !== LOWER_X && x !== UPPER_X) return false;
  for (let digit = 0; digit < XSTRING_DIGITS; digit += 1) {
    if (!isHexDigit(text.charCodeAt(at + XSTRING_DIGITS_OFFSET + digit))) return false;
  }
  return text.charCodeAt(at + XSTRING_CLOSE_OFFSET) === UNDERSCORE;
}

/** Whether `text` holds an `_xHHHH_` escape anywhere. Each '_' costs a bounded look. */
function holdsXstringEscape(text: string): boolean {
  for (let at = text.indexOf('_'); at !== -1; at = text.indexOf('_', at + 1)) {
    if (isXstringEscapeAt(text, at)) return true;
  }
  return false;
}

/** The end of the string literal whose '"' is at `open`; refused when it never closes. */
function stringLiteralEnd(text: string, open: number): SectionEnd {
  for (
    let close = text.indexOf('"', open + 1);
    close !== -1;
    close = text.indexOf('"', close + DOUBLED_DELIMITER_LENGTH)
  ) {
    if (text.charCodeAt(close + 1) !== QUOTE) return close + 1;
  }
  return 'Formula holds a string literal that never closes';
}

/**
 * The end of the quoted section whose apostrophe is at `open`; refused when it never
 * closes or holds a format character, and, when it is a sheet name (`quoted`), a
 * character no sheet name has.
 */
function quotedSectionEnd(text: string, open: number, quoted: QuotedSection): SectionEnd {
  const checksSheetName = CHECKS_SHEET_NAME_CHARACTERS[quoted];
  let at = open + 1;
  while (at < text.length) {
    const code = codePointAt(text, at);
    if (code === APOSTROPHE) {
      if (text.charCodeAt(at + 1) !== APOSTROPHE) return at + 1;
      at += DOUBLED_DELIMITER_LENGTH;
      continue;
    }
    if (checksSheetName && SHEET_NAME_FORBIDDEN.has(code)) {
      return 'Formula holds a path or another workbook in a quoted sheet name';
    }
    if (isFormatCharacter(code)) return 'Formula holds a format character';
    at += codePointLength(code);
  }
  return 'Formula holds a quoted sheet name that never closes';
}

/**
 * The end of the structured reference whose '[' is at `open` (right after a name):
 * where its bracket depth returns to zero, an apostrophe escaping the next character.
 * Refused when it never closes or holds a format character.
 */
function structuredReferenceEnd(text: string, open: number): SectionEnd {
  let depth = 0;
  let at = open;
  while (at < text.length) {
    let code = codePointAt(text, at);
    if (code === APOSTROPHE) {
      at += 1;
      if (at >= text.length) break;
      code = codePointAt(text, at);
    } else if (code === BRACKET_OPEN) {
      depth += 1;
    } else if (code === BRACKET_CLOSE) {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
    if (isFormatCharacter(code)) return 'Formula holds a format character';
    at += codePointLength(code);
  }
  return 'Formula holds a structured reference that never closes';
}

/** Whether a name starts at `at`: a name character, or a '\' (see the header). */
function startsName(text: string, at: number): boolean {
  const code = codePointAt(text, at);
  return code === BACKSLASH || isNameCharacter(code);
}

/**
 * The end of the bracket section (a structured reference or an item selector) whose '['
 * is at `open` (structuredReferenceEnd); refused when a name follows its ']' directly,
 * the [book]Sheet! shape of a reference into another workbook.
 */
function bracketSectionEnd(text: string, open: number): SectionEnd {
  const end = structuredReferenceEnd(text, open);
  if (typeof end === 'number' && startsName(text, end)) {
    return 'Formula holds a reference into another workbook';
  }
  return end;
}

/** The end of the name that starts at `start`: the first code point that is not a name character. */
function nameEnd(text: string, start: number): number {
  let at = start;
  while (at < text.length) {
    const code = codePointAt(text, at);
    if (!isNameCharacter(code)) return at;
    at += codePointLength(code);
  }
  return at;
}

/** Whether the name that ends at `end` is followed, after optional white space, by '('. */
function isCalled(text: string, end: number): boolean {
  let at = end;
  while (at < text.length) {
    const code = codePointAt(text, at);
    if (code === CALL_OPEN) return true;
    if (!isWhiteSpace(code)) return false;
    at += codePointLength(code);
  }
  return false;
}

/** `upperName` without the FUNCTION_PREFIXES at its front, removed repeatedly. */
function withoutFunctionPrefixes(upperName: string): string {
  let start = 0;
  for (;;) {
    const prefix = FUNCTION_PREFIXES.find((candidate) => upperName.startsWith(candidate, start));
    if (prefix === undefined) return upperName.slice(start);
    start += prefix.length;
  }
}

/**
 * Why the name [start, end) of `text` is refused, or null: an internal prefix (but a
 * chart data name that is not called), or a call outside the safe list.
 */
function nameRefusal(text: string, start: number, end: number): string | null {
  const upperName = text.slice(start, end).normalize(NORMAL_FORM).toUpperCase();
  const called = isCalled(text, end);
  if (!called && upperName.startsWith(CHART_DATA_NAME_START)) return null;
  const name = withoutFunctionPrefixes(upperName);
  if (name.startsWith(INTERNAL_PREFIX_START)) return 'Formula holds an internal Excel name prefix';
  if (!called || SAFE_FUNCTIONS.has(name)) return null;
  return 'Formula calls a function outside the safe list';
}

/**
 * The end of the name that starts at `start`, and of the structured reference right
 * after it, if any (bracketSectionEnd); refused for a name nameRefusal refuses, or a '['
 * right after a name that does not start with a Unicode letter or '_' (1[1]Sheet1!A1).
 */
function nameSectionEnd(text: string, start: number): SectionEnd {
  const end = nameEnd(text, start);
  const refusal = nameRefusal(text, start, end);
  if (refusal !== null) return refusal;
  if (text.charCodeAt(end) !== BRACKET_OPEN) return end;
  if (!isNameStart(codePointAt(text, start))) {
    return 'Formula holds a reference into another workbook';
  }
  return bracketSectionEnd(text, end);
}

/**
 * The end of the name that the '\' at `at` starts (see the header): the code point
 * before it is not a name character, ':' or '\', and the one after it is a Unicode
 * letter or '_'. Any other '\' is a path.
 */
function backslashNameEnd(text: string, at: number): SectionEnd {
  const previous = at > 0 ? codePointBefore(text, at) : null;
  const opensName =
    (previous === null ||
      (!isNameCharacter(previous) && previous !== COLON && previous !== BACKSLASH)) &&
    isNameStart(codePointAt(text, at + 1));
  if (!opensName) return 'Formula holds a path';
  return nameSectionEnd(text, at + 1);
}

/**
 * The end of the quoted section whose apostrophe is at `open` (quotedSectionEnd), and,
 * for a field name, of the item selector right after it, if any (bracketSectionEnd).
 */
function quotedEnd(text: string, open: number, quoted: QuotedSection): SectionEnd {
  const end = quotedSectionEnd(text, open, quoted);
  if (typeof end === 'string' || text.charCodeAt(end) !== BRACKET_OPEN) return end;
  if (!OPENS_ITEM_SELECTOR[quoted]) return end;
  return bracketSectionEnd(text, end);
}

/**
 * The end of the THIS_WORKBOOK prefix whose '[' is at `open`, when a name follows it;
 * any other '[' that follows no name is a reference into another workbook.
 */
function thisWorkbookEnd(text: string, open: number): SectionEnd {
  const end = open + THIS_WORKBOOK.length;
  if (text.startsWith(THIS_WORKBOOK, open) && end < text.length) {
    if (isNameStart(codePointAt(text, end))) return end;
  }
  return 'Formula holds a reference into another workbook';
}

/** One reading of `text` (see the header), its quoted sections read as `quoted`: why it is refused, or null. */
function readingRefusal(text: string, quoted: QuotedSection): string | null {
  if (holdsXstringEscape(text)) return 'Formula holds an _xHHHH_ escape';
  let at = 0;
  while (at < text.length) {
    const code = codePointAt(text, at);
    let end: SectionEnd = at + codePointLength(code);
    if (code === QUOTE) {
      end = stringLiteralEnd(text, at);
    } else if (code === APOSTROPHE) {
      end = quotedEnd(text, at, quoted);
    } else if (isFormatCharacter(code)) {
      return 'Formula holds a format character';
    } else if (code === DDE_BAR) {
      return 'Formula holds a DDE link';
    } else if (code === BACKSLASH) {
      end = backslashNameEnd(text, at);
    } else if (code === BRACKET_OPEN) {
      end = thisWorkbookEnd(text, at);
    } else if (code === BRACKET_CLOSE) {
      return 'Formula holds a bracket that closes nothing';
    } else if (code === CALL_OPEN && EXPRESSION_ENDS.has(text.charCodeAt(at - 1))) {
      return 'Formula calls the result of an expression';
    } else if (isNameCharacter(code)) {
      end = nameSectionEnd(text, at);
    }
    if (typeof end === 'string') return end;
    at = end;
  }
  return null;
}

/**
 * Why the decoded formula field text `text` is refused (a fixed English message), or
 * null when both its readings pass: unchanged and in NFKC form (see the header). Its
 * apostrophe-quoted sections name what `quoted` says: sheets unless told otherwise.
 */
export function formulaTextRefusal(
  text: string,
  quoted: QuotedSection = 'sheet-name',
): string | null {
  if (text.length > MAX_FORMULA_TEXT_LENGTH) return 'Formula is longer than Excel writes one';
  const refusal = readingRefusal(text, quoted);
  if (refusal !== null) return refusal;
  const normal = text.normalize(NORMAL_FORM);
  return normal === text ? null : readingRefusal(normal, quoted);
}
