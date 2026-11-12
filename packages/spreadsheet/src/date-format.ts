// read-excel-file decides whether a numeric cell is a date by classifying the
// custom number format of its style (`formatCode`) and caches every template it
// classifies in a module-level object that is never cleared
// (read-excel-file/modules/xlsx/isDateFormat.js, `CACHE`). Each upload could add
// arbitrary templates to that cache, so the read copy rewrites every format code
// to one of two canonical codes that the reader classifies exactly as it would
// have classified the original. The cache then holds at most these two keys.
//
// `isReaderDateFormat` mirrors the reader's `isDateFormat` line for line:
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

/** The format code a date-formatted style is rewritten to; the reader reads it as a date. */
export const DATE_FORMAT_CODE = 'yyyy-mm-dd';
/** The format code every other style is rewritten to; the reader reads it as a number. */
export const NUMBER_FORMAT_CODE = '0';

/** read-excel-file's `isDateFormat`, reimplemented without its cache. */
export function isReaderDateFormat(template: string): boolean {
  const stripped = template
    .toLowerCase()
    .replace(DATE_FORMAT_SPECIFIC_LOCALE_PREFIX, '')
    .replace(DATE_FORMAT_ALLOW_ANY_OTHER_TEXT_SUFFIX, '');
  return stripped.split(TOKEN_SEPARATOR).every((token) => DATE_TEMPLATE_TOKENS.includes(token));
}

/** The canonical format code the reader classifies exactly like `template`. */
export function canonicalFormatCode(template: string): string {
  return isReaderDateFormat(template) ? DATE_FORMAT_CODE : NUMBER_FORMAT_CODE;
}
