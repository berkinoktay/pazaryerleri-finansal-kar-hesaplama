// Whether a numeric cell reads as a date, by the old reader's rules (reader contract,
// section 3): its style's number format id is a built-in date format, or its custom
// format code (`formatCode`) classifies as a date. The old reader cached every
// template it classified in a module-level object that was never cleared; this
// classifier keeps no cache, so an upload cannot grow the process's memory with
// templates.
//
// `isReaderDateFormat` mirrors the old reader's `isDateFormat`
// (modules/xlsx/isDateFormat.js, 9.2.0) line for line:
//   template = template.toLowerCase()
//   template = template.replace(/^\[\$-[^\]]+\]/, '')   // "[$-...]" locale prefix
//   template = template.replace(/;@$/, '')              // ";@" text-section suffix
//   tokens = template.split(/\W+/)
//   every token must be in DATE_TEMPLATE_TOKENS
// The token list is copied verbatim from that file (including its duplicate 'mm').

const DATE_FORMAT_SPECIFIC_LOCALE_PREFIX = /^\[\$-[^\]]+\]/;
const DATE_FORMAT_ALLOW_ANY_OTHER_TEXT_SUFFIX = /;@$/;
const TOKEN_SEPARATOR = /\W+/;

const DATE_TEMPLATE_TOKENS: readonly string[] = [
  'ss',
  'mm',
  'h',
  'hh',
  'am',
  'pm',
  'd',
  'dd',
  'm',
  'mm',
  'mmm',
  'mmmm',
  'yy',
  'yyyy',
  'e',
];

/** The old reader's `isDateFormat`, reimplemented without its cache. */
export function isReaderDateFormat(template: string): boolean {
  const stripped = template
    .toLowerCase()
    .replace(DATE_FORMAT_SPECIFIC_LOCALE_PREFIX, '')
    .replace(DATE_FORMAT_ALLOW_ANY_OTHER_TEXT_SUFFIX, '');
  return stripped.split(TOKEN_SEPARATOR).every((token) => DATE_TEMPLATE_TOKENS.includes(token));
}

/**
 * Built-in number format ids that format a date, whatever the template: the old
 * reader's BUILT_IN_DATE_FORMAT_IDS (modules/xlsx/isDateFormatStyle.js, lines 40-185),
 * copied id by id. The reader concatenated the locale lists and skipped ids already
 * present.
 */
export const BUILTIN_DATE_FORMAT_IDS: ReadonlySet<number> = new Set([
  // Locale independent.
  14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47,
  // zh-tw / zh-cn; the ja-jp / ko-kr list holds these same ids.
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  // th-th.
  71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
]);

// The old reader's parseExcelDate (modules/xlsx/parseExcelDate.js): a 1904-system
// serial is moved onto the 1900 system by adding 1462 days, and 25569 is the 1900-system
// serial of 1970-01-01. There is no correction for Excel's fictitious 1900-02-29, so a
// serial before 61 lands one day early, exactly as in the reader.
const EPOCH_1904_OFFSET_DAYS = 1462;
const UNIX_EPOCH_SERIAL = 25569;
const MS_PER_DAY = 86_400_000;

/** An Excel serial date as a Date whose UTC wall clock is the serial's, as the reader reads it. */
export function excelSerialToDate(serial: number, epoch1904: boolean): Date {
  const days = serial + (epoch1904 ? EPOCH_1904_OFFSET_DAYS : 0) - UNIX_EPOCH_SERIAL;
  return new Date(Math.floor(days * MS_PER_DAY));
}
