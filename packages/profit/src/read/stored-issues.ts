import { type Prisma } from '@pazarsync/db';
import { ProfitIssueCode } from '@pazarsync/db/enums';

import { type ProfitIssue } from '../core/profit-issue';
import { InvalidStoredProfitDataError } from '../persistence/errors';

/** The valid issue codes, read once from the enum so a new code flows through automatically. */
const ISSUE_CODES: readonly string[] = Object.values(ProfitIssueCode);

/** A type guard for a known issue code; never a cast. */
function isIssueCode(value: string): value is ProfitIssueCode {
  return ISSUE_CODES.includes(value);
}

/**
 * Parses a persisted `issues` JSON value back into engine `ProfitIssue`s. The value
 * must be an array of objects `{ code, orderItemId, detail }` where `code` is a known
 * `ProfitIssueCode` and `orderItemId` and `detail` are each a string or null. Anything
 * else throws `InvalidStoredProfitDataError` naming the offending field.
 */
export function parseStoredIssues(value: Prisma.JsonValue): readonly ProfitIssue[] {
  if (!Array.isArray(value)) {
    throw new InvalidStoredProfitDataError('stored issues must be a JSON array');
  }
  return value.map((entry) => parseStoredIssue(entry));
}

function parseStoredIssue(value: Prisma.JsonValue): ProfitIssue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidStoredProfitDataError('a stored issue must be a JSON object');
  }
  const code = value['code'];
  if (typeof code !== 'string' || !isIssueCode(code)) {
    throw new InvalidStoredProfitDataError(`unknown profit issue code ${String(code)}`);
  }
  return {
    code,
    orderItemId: parseNullableString(value['orderItemId'], 'orderItemId'),
    detail: parseNullableString(value['detail'], 'detail'),
  };
}

/** A stored issue field that must be a string or null; anything else (including missing) throws. */
function parseNullableString(value: Prisma.JsonValue | undefined, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new InvalidStoredProfitDataError(`stored issue ${field} must be a string or null`);
  }
  return value;
}
