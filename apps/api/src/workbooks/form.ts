// The rules for what a seller sends in a workbook form. The uploaded file of every import
// form: a `file` part that is a file. The one rule for a stored list name, typed by the
// seller or read from a file: no control or format character (a bidi override can make a
// name read as something else), no surrounding whitespace, at most UPLOAD_NAME_MAX_LENGTH
// long. And the rule for a campaign window instant: an ISO date time whose UTC year the
// database can store. Each rule's message is a field issue code.

import { z } from '@hono/zod-openapi';

import { UPLOAD_NAME_MAX_LENGTH, type WorkbookFormFileCode } from '@pazarsync/utils';

import { isStorableYear } from './column-range';

/**
 * Field issue code of an import without a `file` part, or with a `file` part that is not
 * a file (a plain text field). One of the shared `WORKBOOK_FORM_FILE_CODES`, which the web
 * maps to a message.
 */
export const FILE_REQUIRED = 'FILE_REQUIRED' satisfies WorkbookFormFileCode;
/** Field issue code of a name above UPLOAD_NAME_MAX_LENGTH. */
export const NAME_TOO_LONG = 'NAME_TOO_LONG';
/** Field issue code of a name holding a control or format character. */
export const NAME_INVALID_CHARACTERS = 'NAME_INVALID_CHARACTERS';
/** Field issue code of a name that is empty after trimming, where a name is required. */
export const NAME_REQUIRED = 'NAME_REQUIRED';
/** Field issue code of a window instant that is not an ISO date time with an offset. */
export const INVALID_DATE = 'INVALID_DATE';
/** Field issue code of a window instant whose UTC year is outside the storable years. */
export const DATE_OUT_OF_RANGE = 'DATE_OUT_OF_RANGE';

const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}]/gu;
const NO_CONTROL_OR_FORMAT_RE = /^[^\p{Cc}\p{Cf}]*$/u;

/**
 * The `file` field of a workbook import form: the uploaded `.xlsx`, a binary string in the
 * spec. A missing part or a part that is not a file answers FILE_REQUIRED. Each import form
 * passes its own spec description.
 */
export function workbookFileField(description: string): z.ZodInstanceOf<File> {
  return z
    .instanceof(File, { error: FILE_REQUIRED })
    .openapi({ type: 'string', format: 'binary', description });
}

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

/**
 * A list name a rename must not leave empty (the two config update bodies). The trim
 * runs first, so a whitespace-only name answers NAME_REQUIRED like an empty one.
 */
export const RequiredNameSchema: z.ZodString = NameSchema.min(1, NAME_REQUIRED);

// The plain format of a window instant, without a message: the year rule below tests a
// text against it to skip one the format check already refused.
const WINDOW_INSTANT_FORMAT = z.string().datetime({ offset: true });

/**
 * A campaign window bound on the wire (`startsAt`, `endsAt` of the discount and campaign
 * configs, on import and on update). A malformed text answers INVALID_DATE, and a date
 * time whose UTC year the database cannot store answers DATE_OUT_OF_RANGE; one issue per
 * bad date. The format check does not abort: an abort would also stop the config's
 * object-level rules, so a bad date would hide another field's issue of the same submit.
 * The year rule therefore passes a text the format refused (`new Date` parses some texts
 * that are no date time, such as '0000-01-01').
 */
export const WindowInstantSchema: z.ZodString = z
  .string()
  .datetime({ offset: true, error: INVALID_DATE })
  .refine(
    (text) => !WINDOW_INSTANT_FORMAT.safeParse(text).success || isStorableYear(new Date(text)),
    DATE_OUT_OF_RANGE,
  );

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
