import { SyncErrorCode } from '@pazarsync/db/enums';

const SYNC_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

function isSyncErrorCode(value: string): value is SyncErrorCode {
  return SYNC_ERROR_CODE_VALUES.has(value);
}

/**
 * Narrow an unknown caught value to a `SyncErrorCode` for `sync_log.error_code`.
 * Anything that doesn't carry a known enum value coerces to `INTERNAL_ERROR` —
 * the DB rejects anything else, and silent loss of granularity is preferable
 * to a crash mid-failure-handling. The original diagnostic is preserved in
 * `error_message` by callers.
 */
export function errorCodeOf(err: unknown): SyncErrorCode {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && isSyncErrorCode(code)) {
      return code;
    }
  }
  return SyncErrorCode.INTERNAL_ERROR;
}
