// The name an upload is stored under, and the header a download carries it in. The
// raw upload name never reaches a response: it can hold path separators, bidi
// overrides and control characters, and any length.

import { UPLOAD_NAME_MAX_LENGTH } from '../config/workbook-limits';
import { stripControlAndFormat, truncateCodePoints } from './form';

// ASCII case-insensitive on purpose: without the `u` flag, `i` never folds a non-ASCII
// character (such as U+017F or U+212A) onto an ASCII letter.
const XLSX_EXTENSION_RE = /\.xlsx$/i;
const XLSX_EXTENSION_LENGTH = '.xlsx'.length;
const PATH_SEPARATORS_RE = /[/\\]/g;

const ASCII_PRINTABLE_FIRST = 0x20;
const ASCII_PRINTABLE_LAST = 0x7e;
const ASCII_PLACEHOLDER = '_';
const QUOTED_STRING_SPECIALS: ReadonlySet<string> = new Set(['"', '\\']);
// Left as they are by encodeURIComponent, but not allowed in an RFC 8187 value.
const RFC8187_EXTRA_RE = /['()*!]/g;
// An unpaired surrogate would make encodeURIComponent throw.
const LONE_SURROGATE_RE = /\p{Surrogate}/gu;
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);
const HEX_RADIX = 16;

/**
 * A clean name for an uploaded file, or null when it has no usable one: every
 * `\p{Cc}` and `\p{Cf}` character and every `/` and `\` dropped; then NFC (after the
 * drop, so a dropped character between a letter and its combining mark cannot leave
 * the name decomposed); trimmed; it must end with `.xlsx` (ASCII case-insensitive,
 * kept as written) after a non-empty stem. Above UPLOAD_NAME_MAX_LENGTH code points,
 * the stem is cut by code point so the name is exactly that long. Never rejects an
 * upload: the file's bytes decide what it is.
 */
export function sanitizeUploadFilename(raw: string): string | null {
  const name = stripControlAndFormat(raw).replace(PATH_SEPARATORS_RE, '').normalize('NFC').trim();
  if (!XLSX_EXTENSION_RE.test(name)) return null;
  const stem = name.slice(0, -XLSX_EXTENSION_LENGTH);
  if (stem === '') return null;
  const extension = name.slice(-XLSX_EXTENSION_LENGTH);
  return `${truncateCodePoints(stem, UPLOAD_NAME_MAX_LENGTH - XLSX_EXTENSION_LENGTH)}${extension}`;
}

function asciiFallback(filename: string): string {
  return Array.from(filename, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    const printable = codePoint >= ASCII_PRINTABLE_FIRST && codePoint <= ASCII_PRINTABLE_LAST;
    return printable && !QUOTED_STRING_SPECIALS.has(char) ? char : ASCII_PLACEHOLDER;
  }).join('');
}

function percentEncode(char: string): string {
  return `%${char.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`;
}

function rfc8187Value(filename: string): string {
  return encodeURIComponent(filename.replace(LONE_SURROGATE_RE, REPLACEMENT_CHARACTER)).replace(
    RFC8187_EXTRA_RE,
    percentEncode,
  );
}

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<enc>`: `<ascii>` has every
 * character outside 0x20..0x7E, and `"` and `\`, replaced by `_`; `<enc>` is the name
 * percent-encoded per RFC 8187.
 */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc8187Value(filename)}`;
}
