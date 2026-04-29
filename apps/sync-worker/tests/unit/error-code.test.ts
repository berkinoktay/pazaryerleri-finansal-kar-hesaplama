import { describe, expect, it } from 'vitest';
import { SyncErrorCode } from '@pazarsync/db/enums';

import { errorCodeOf } from '../../src/error-code';

describe('errorCodeOf — sync_log.error_code gate', () => {
  it('returns the matching SyncErrorCode when caught error has a known .code', () => {
    expect(errorCodeOf({ code: 'MARKETPLACE_AUTH_FAILED' })).toBe(
      SyncErrorCode.MARKETPLACE_AUTH_FAILED,
    );
    expect(errorCodeOf({ code: 'MARKETPLACE_UNREACHABLE' })).toBe(
      SyncErrorCode.MARKETPLACE_UNREACHABLE,
    );
  });

  it('returns INTERNAL_ERROR when caught error has an UNKNOWN .code (the gate)', () => {
    // The DB now rejects anything not in SyncErrorCode. Without this
    // coercion, a Node fs/net error like 'EAGAIN' would crash the
    // INSERT in sync-log.service. Guarding here is load-bearing.
    expect(errorCodeOf({ code: 'EAGAIN' })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: 'PRISMA_P2002' })).toBe(SyncErrorCode.INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR for non-object inputs', () => {
    expect(errorCodeOf(null)).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf(undefined)).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf('some string')).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf(42)).toBe(SyncErrorCode.INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR when .code exists but is not a string', () => {
    expect(errorCodeOf({ code: 42 })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: null })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: { nested: true } })).toBe(SyncErrorCode.INTERNAL_ERROR);
  });
});
