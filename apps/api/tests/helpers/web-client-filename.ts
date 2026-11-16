// The web client's reading of a download name, mirrored from `filenameFromDisposition`
// in apps/web/src/features/campaigns/api/binary-download.ts (the api cannot import from
// the web app). It reads the header's own parameters only: the header is split at each
// `;` outside a quoted string, the first `filename*=UTF-8''` value that decodes wins,
// else the first `filename`. A test can therefore prove that the name a header carries
// is the name the seller's browser saves. Keep it in step with the web function: from
// its `export function` line to the end of the file the two are the same code.

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

export function webClientFilename(header: string | null): string | null {
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
