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

// Every character outside the few the quoted `filename` fallback keeps. Parameter
// syntax (`;`, `=`, `*`, `'`, `%`) never stays: a client that reads the header without
// honoring the quotes would take a `filename*=` inside the fallback as the parameter,
// and save the file under a name and extension the uploader chose. The `u` flag makes
// an astral character one match.
const ASCII_FALLBACK_UNSAFE_RE = /[^A-Za-z0-9 ._()-]/gu;
const ASCII_PLACEHOLDER = '_';
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
  return filename.replace(ASCII_FALLBACK_UNSAFE_RE, ASCII_PLACEHOLDER);
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
 * `attachment; filename="<ascii>"; filename*=UTF-8''<enc>`: `<ascii>` keeps ASCII
 * letters, digits, space and `.`, `_`, `(`, `)`, `-`, and has every other character
 * (one per code point) replaced by `_`, so it never holds a quote, a backslash or
 * parameter syntax; `<enc>` is the name percent-encoded per RFC 8187.
 */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc8187Value(filename)}`;
}
