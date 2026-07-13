'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { toast } from '@/components/ui/sonner';
import { useCurrentScope } from '@/providers/current-scope';

import type { SyncLog } from '../api/list-org-sync-logs.api';
import { useSyncFailureToaster } from '../hooks/use-sync-failure-toaster';
import { useOrgSyncs } from '../providers/org-syncs-provider';

/**
 * Render-less effect component, mounted once under OrgSyncsProvider +
 * CurrentScopeProvider. When one of the active store's sync flows dies with a
 * terminal FAILED status, it raises a single destructive toast so a seller on
 * another page still learns the flow failed (issue #468, rescoped to
 * failure-only: success is confirmed in-control + auto-refresh, so a success
 * toast for hourly background flows would be noise).
 *
 * FAILED_RETRYABLE does not toast (the run isn't dead yet) and there is no
 * action — the page's own control already turns red when the seller navigates
 * there. One toast per run (deduped by sync-log id in the detection hook).
 */
export function SyncFailureToaster(): React.ReactElement | null {
  const t = useTranslations('syncControl');
  const { store } = useCurrentScope();
  const { activeSyncs, recentSyncs } = useOrgSyncs();

  const onFailure = React.useCallback(
    (log: SyncLog): void => {
      toast.error(t('failureToast', { domain: t(`domain.${log.syncType}`) }));
    },
    [t],
  );

  useSyncFailureToaster({
    storeId: store?.id ?? null,
    activeSyncs,
    recentSyncs,
    onFailure,
  });

  return null;
}
