/**
 * Shared helpers for the workbook export endpoints of the campaign pages. Every export
 * endpoint returns a file on success but a JSON ProblemDetails on error, and names the
 * file (`.xlsx` or `.zip`) in `Content-Disposition`. The filename parser and the
 * download-file shape live here, read by the one export function (`workbook.api.ts`).
 */

/** A downloaded export: the file bytes plus the server-chosen name (`.xlsx` or `.zip`). */
export interface WorkbookExportFile {
  readonly blob: Blob;
  /** From `Content-Disposition`; null if the header is absent (caller falls back). */
  readonly filename: string | null;
}

/** The two parameter names that name a download, compared lower-cased. */
const EXT_FILENAME_PARAMETER = 'filename*';
const PLAIN_FILENAME_PARAMETER = 'filename';
/** An RFC 8187 value in the one charset the backend sends; the capture is percent-encoded. */
const UTF8_EXT_VALUE_RE = /^UTF-8''(.+)$/i;
/** A whole quoted string: plain characters or backslash pairs between two quotes. */
const QUOTED_STRING_RE = /^"((?:[^"\\]|\\.)*)"$/;
/** The two quoted pairs a quoted value is unescaped of. */
const QUOTED_PAIR_RE = /\\(["\\])/g;

interface DispositionParameter {
  /** Trimmed and lower-cased. */
  readonly name: string;
  /** Trimmed, still quoted if it was. */
  readonly value: string;
}

/** Splits at each `;` outside a quoted string; inside one, a backslash escapes the next character. */
function splitDispositionParts(header: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of header) {
    if (!quoted && char === ';') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
    if (escaped) {
      escaped = false;
    } else if (quoted && char === '\\') {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    }
  }
  parts.push(current);
  return parts;
}

/** `name=value`, cut at the first `=`; null for a part without one. */
function parseDispositionParameter(part: string): DispositionParameter | null {
  const equals = part.indexOf('=');
  if (equals === -1) return null;
  return {
    name: part.slice(0, equals).trim().toLowerCase(),
    value: part.slice(equals + 1).trim(),
  };
}

/** A quoted string without its quotes and with `\"` and `\\` unescaped, or a bare token as it is. */
function unquoteDispositionValue(value: string): string | null {
  if (!value.startsWith('"')) return value;
  const inner = QUOTED_STRING_RE.exec(value)?.[1];
  if (inner === undefined) return null;
  return inner.replace(QUOTED_PAIR_RE, '$1');
}

/** The decoded name of a `filename*` value; null when it is not `UTF-8''` or does not decode. */
function decodeExtFilename(value: string): string | null {
  const unquoted = unquoteDispositionValue(value);
  if (unquoted === null) return null;
  const encoded = UTF8_EXT_VALUE_RE.exec(unquoted)?.[1];
  if (encoded === undefined) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function nonEmptyName(name: string | null): string | null {
  return name === '' ? null : name;
}

/**
 * Reads the download filename from a `Content-Disposition` header, from its own
 * parameters only: the header is split at each `;` outside a quoted string, so a
 * quoted value that holds `filename*=` stays one value. The first `filename*` whose
 * value is `UTF-8''<pct-encoded>` and decodes wins (Turkish names, the backend's
 * format), else the first `filename` (a quoted string or a bare token). Returns null
 * when neither yields a non-empty name, so the caller can supply its own.
 */
export function filenameFromDisposition(header: string | null): string | null {
  if (header === null) return null;
  const parameters = splitDispositionParts(header)
    .slice(1)
    .map(parseDispositionParameter)
    .filter((parameter) => parameter !== null);
  for (const parameter of parameters) {
    if (parameter.name !== EXT_FILENAME_PARAMETER) continue;
    const decoded = nonEmptyName(decodeExtFilename(parameter.value));
    if (decoded !== null) return decoded;
  }
  const plain = parameters.find((parameter) => parameter.name === PLAIN_FILENAME_PARAMETER);
  if (plain === undefined) return null;
  return nonEmptyName(unquoteDispositionValue(plain.value));
}
