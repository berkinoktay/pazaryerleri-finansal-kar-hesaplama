'use client';

import * as React from 'react';

import { CAPABILITIES, type WorkbookPage } from '@pazarsync/utils';

import {
  type CampaignAccess,
  resolveCampaignAccess,
} from '@/features/campaigns/lib/campaign-access';
import { useCan, useCurrentStore } from '@/providers/current-scope';

/**
 * Resolves what the current member may do on one campaign page from the dashboard scope: the
 * member's `DATA_WRITE` capability and the platform of the store in scope. Only the top-level
 * list and detail clients call it; they hand the result to `CampaignAccessProvider`. Memoized
 * on its inputs so the provided value keeps its identity across renders. UX only: the backend
 * enforces every permission.
 */
export function useResolvedCampaignAccess(page: WorkbookPage): CampaignAccess {
  const canWrite = useCan(CAPABILITIES.DATA_WRITE);
  const platform = useCurrentStore()?.platform ?? null;

  return React.useMemo(
    () => resolveCampaignAccess({ canWrite, platform, page }),
    [canWrite, platform, page],
  );
}
