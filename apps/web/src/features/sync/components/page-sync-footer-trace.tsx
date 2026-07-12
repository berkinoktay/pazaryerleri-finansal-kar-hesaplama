'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { TimeAgo } from '@/components/patterns/time-ago';

import { type PageSyncKey } from '../config/page-sync-sources';
import { usePageSyncSnapshot } from '../hooks/use-page-sync-snapshot';

interface PageSyncFooterTraceProps {
  pageKey: PageSyncKey;
}

/**
 * The DataTable footer "Son güncelleme · <relative>" trace, isolated to its own
 * leaf so the page client + its DataTable never subscribe to this hook. The
 * relative label is latched at mount (usePageSyncSnapshot no longer ticks) and
 * refreshes when the sync data changes — no per-second re-render. The page
 * passes this component into the pagination `leading` slot and never calls
 * usePageSyncSnapshot itself.
 *
 * Renders `null` until the page's sources have a successful sync
 * (`control.lastSyncedAt === null`), matching the pre-extraction behavior where
 * the footer slot stayed empty on a never-synced store.
 */
export function PageSyncFooterTrace({
  pageKey,
}: PageSyncFooterTraceProps): React.ReactElement | null {
  const t = useTranslations('syncControl');
  const { control, now } = usePageSyncSnapshot(pageKey);

  if (control.lastSyncedAt === null) {
    return null;
  }

  return (
    <>
      <span>{t('tableFooter')}</span>{' '}
      <TimeAgo value={control.lastSyncedAt} now={now ?? undefined} recentLabel={t('row.justNow')} />
    </>
  );
}
