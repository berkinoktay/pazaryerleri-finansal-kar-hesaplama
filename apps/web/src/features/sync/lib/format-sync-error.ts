import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

const KNOWN_SYNC_ERROR_CODES = [
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'MARKETPLACE_UNREACHABLE',
  'SYNC_IN_PROGRESS',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
] as const;

type KnownSyncErrorCode = (typeof KNOWN_SYNC_ERROR_CODES)[number];

const KNOWN_SYNC_ERROR_CODE_SET: ReadonlySet<string> = new Set(KNOWN_SYNC_ERROR_CODES);

function isKnownSyncErrorCode(value: string): value is KnownSyncErrorCode {
  return KNOWN_SYNC_ERROR_CODE_SET.has(value);
}

export interface SyncErrorCopy {
  title: string;
  description: string;
}

export type SyncErrorFormatter = (code: string | null | undefined) => SyncErrorCopy | null;

/**
 * Translates a SyncLog `errorCode` (e.g. `MARKETPLACE_AUTH_FAILED`) into the
 * `{ title, description }` copy pair the SyncCenter rows + retry banner consume.
 *
 * - `null` / `undefined` input → `null` (no error to render)
 * - Unknown code → the `fallback` copy (still localized, no raw enum leak)
 *
 * The known-codes list mirrors the `code` literals declared on each domain
 * error class in `packages/sync-core/src/errors.ts`. When a new error class
 * is added there, this list and `messages/{tr,en}.json` must be updated
 * together; the `fallback` branch is the safety net if anyone forgets.
 */
export function useFormatSyncError(): SyncErrorFormatter {
  const t = useTranslations('syncCenter.errors');
  return useCallback(
    (code) => {
      if (code === null || code === undefined) return null;
      const key = isKnownSyncErrorCode(code) ? code : 'fallback';
      return {
        title: t(`${key}.title`),
        description: t(`${key}.description`),
      };
    },
    [t],
  );
}
