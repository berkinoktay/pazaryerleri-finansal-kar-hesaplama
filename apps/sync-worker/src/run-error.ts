// Terminal error routing for a failed sync run. Extracted from index.ts
// (PR-13) so the syncType gate on the skip-bad-page recovery is unit-
// testable — index.ts cannot be imported by tests (top-level main()).

import type { SyncType } from '@pazarsync/db';
import { SyncErrorCode } from '@pazarsync/db/enums';
import { markRetryable, syncLogService } from '@pazarsync/sync-core';

import { errorCodeOf } from './error-code';
import { advanceCursorPastBadPage } from './skip-bad-page';

export const MAX_ATTEMPTS = 5;

// Permanent failure codes — markFailed terminally, never markRetryable.
// Adding a new permanent code? Update this set + add a comment in the
// handler that throws it explaining why retry would not help.
// Note: CORRUPT_CHECKPOINT is not in SyncErrorCode; errorCodeOf() coerces
// unknown codes to INTERNAL_ERROR, so a corrupt-checkpoint throw reaches
// the markRetryable path (transient) rather than this set.
export const PERMANENT_FAILURE_CODES: ReadonlySet<SyncErrorCode> = new Set<SyncErrorCode>([
  SyncErrorCode.MARKETPLACE_AUTH_FAILED,
  SyncErrorCode.MARKETPLACE_ACCESS_DENIED,
]);

export function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export async function handleRunError(
  syncLogId: string,
  syncType: SyncType,
  attemptCount: number,
  err: unknown,
): Promise<void> {
  const code = errorCodeOf(err);
  const message = errorMessageOf(err);

  if (PERMANENT_FAILURE_CODES.has(code)) {
    await syncLogService.fail(syncLogId, code, message);
    return;
  }

  if (attemptCount >= MAX_ATTEMPTS) {
    // Skip-bad-page recovery: a single deterministic upstream 5xx on
    // one Trendyol page (real-world: a corrupted seller record at a
    // specific catalog offset) used to terminate the whole sync at
    // ~50% completion. Now we advance the cursor past the offending
    // page and let the rest of the catalog finish; the skipped page
    // is recorded on `SyncLog.skippedPages` and surfaced in the UI so
    // the merchant sees what didn't sync.
    //
    // PRODUCTS-ONLY: the recovery decodes the products page cursor.
    // Cursorless full-window scans (CLAIMS, SETTLEMENTS) have no
    // "page to skip" — letting them in here fabricated phantom
    // skipped-page entries and reset attemptCount in a loop instead
    // of failing terminally (the next 6h cron re-scans everything
    // anyway, so terminal FAIL is the correct outcome for them).
    if (syncType === 'PRODUCTS' && code === SyncErrorCode.MARKETPLACE_UNREACHABLE) {
      const advanced = await advanceCursorPastBadPage(syncLogId, err);
      if (advanced) return;
    }
    await syncLogService.fail(syncLogId, code, `${message} (max retries reached)`);
    return;
  }

  await markRetryable(syncLogId, attemptCount, code, message);
}
