// The one rule for a stored list name, typed by the seller or read from a file: no
// control or format character (a bidi override can make a name read as something
// else), no surrounding whitespace, at most UPLOAD_NAME_MAX_LENGTH long.

import { z } from '@hono/zod-openapi';

import { UPLOAD_NAME_MAX_LENGTH } from '../config/workbook-limits';

/** Field issue code of a name above UPLOAD_NAME_MAX_LENGTH. */
export const NAME_TOO_LONG = 'NAME_TOO_LONG';
/** Field issue code of a name holding a control or format character. */
export const NAME_INVALID_CHARACTERS = 'NAME_INVALID_CHARACTERS';

const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}]/gu;
const NO_CONTROL_OR_FORMAT_RE = /^[^\p{Cc}\p{Cf}]*$/u;

/**
 * A typed list name on the wire; each rule's message is its field issue code. The
 * spec's `pattern` is given by hand: the generator writes a flagged regex with its
 * `/u` suffix, a pattern no value matches.
 */
export const NameSchema: z.ZodString = z
  .string()
  .trim()
  .max(UPLOAD_NAME_MAX_LENGTH, NAME_TOO_LONG)
  .regex(NO_CONTROL_OR_FORMAT_RE, NAME_INVALID_CHARACTERS)
  .openapi({ pattern: NO_CONTROL_OR_FORMAT_RE.source });

/** `text` without its control (`\p{Cc}`) and format (`\p{Cf}`) characters. */
export function stripControlAndFormat(text: string): string {
  return text.replace(CONTROL_OR_FORMAT_RE, '');
}

/**
 * The first `max` code points of `text`: a surrogate pair is never split (a lone
 * surrogate counts as one code point). It walks the text only up to the cut, so a
 * multi-megabyte input costs no more than `max` steps.
 */
export function truncateCodePoints(text: string, max: number): string {
  let end = 0;
  let count = 0;
  // A string iterates by code point: `char` is one UTF-16 unit or a whole pair.
  for (const char of text) {
    if (count >= max) return text.slice(0, end);
    end += char.length;
    count += 1;
  }
  return text;
}

/**
 * One rule for every stored name, typed by the user or read from a file: drop
 * `\p{Cc}` and `\p{Cf}`, trim, cut to `max` CODE POINTS (never inside a surrogate
 * pair), and trim the end the cut may have left.
 */
export function cleanDisplayName(raw: string, max: number): string {
  return truncateCodePoints(stripControlAndFormat(raw).trim(), max).trimEnd();
}
