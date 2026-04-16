const CURRENT_CURSOR_VERSION = 1 as const;

export interface CursorPayload {
  sort: string;
  values: Record<string, string | number | null> & { id: string };
}

interface EncodedCursor {
  v: number;
  sort: string;
  values: CursorPayload['values'];
}

export class InvalidCursorError extends Error {
  override name = 'InvalidCursorError';
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
  }
}

export class CursorSortMismatchError extends Error {
  override name = 'CursorSortMismatchError';
  constructor(
    public cursorSort: string,
    public requestSort: string,
  ) {
    super(`Cursor was issued for sort "${cursorSort}" but request sort is "${requestSort}"`);
  }
}

export function encodeCursor(payload: CursorPayload): string {
  const obj: EncodedCursor = {
    v: CURRENT_CURSOR_VERSION,
    sort: payload.sort,
    values: payload.values,
  };
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
}

export function decodeCursor(cursor: string, expectedSort: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new InvalidCursorError('not valid base64-encoded JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).v !== 'number' ||
    typeof (parsed as Record<string, unknown>).sort !== 'string' ||
    typeof (parsed as Record<string, unknown>).values !== 'object' ||
    (parsed as Record<string, unknown>).values === null
  ) {
    throw new InvalidCursorError('missing required fields (v, sort, values)');
  }

  const { v, sort, values } = parsed as EncodedCursor;

  if (v !== CURRENT_CURSOR_VERSION) {
    throw new InvalidCursorError(`unsupported cursor version ${v}`);
  }

  if (typeof values.id !== 'string') {
    throw new InvalidCursorError("missing required tiebreaker 'id' in values");
  }

  if (sort !== expectedSort) {
    throw new CursorSortMismatchError(sort, expectedSort);
  }

  return { sort, values };
}
