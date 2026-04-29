import { isSyncErrorCode } from '@pazarsync/db/enums';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

export interface SyncErrorCopy {
  title: string;
  description: string;
}

export type SyncErrorFormatter = (code: string | null | undefined) => SyncErrorCopy | null;

/**
 * Translates a SyncLog `errorCode` into the `{ title, description }` copy pair
 * the SyncCenter rows + retry banner consume.
 *
 * - `null` / `undefined` input → `null` (no error to render)
 * - Unknown code → the `fallback` copy (still localized, no raw enum leak)
 *
 * The known-set comes from `Object.values(SyncErrorCode)` via the shared
 * `isSyncErrorCode` guard in `@pazarsync/db/enums`. Adding a new sync error
 * code requires only `schema.prisma` (plus the matching `syncCenter.errors.<CODE>`
 * entry in `messages/{tr,en}.json`) — the frontend stays in sync via codegen,
 * no manual list maintenance.
 */
export function useFormatSyncError(): SyncErrorFormatter {
  const t = useTranslations('syncCenter.errors');
  return useCallback(
    (code) => {
      if (code === null || code === undefined) return null;
      const key = isSyncErrorCode(code) ? code : 'fallback';
      return {
        title: t(`${key}.title`),
        description: t(`${key}.description`),
      };
    },
    [t],
  );
}
