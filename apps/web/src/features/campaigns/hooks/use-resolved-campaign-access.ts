'use client';

import { CAPABILITIES, type WorkbookPage } from '@pazarsync/utils';

import { useCan, useCurrentStore } from '@/providers/current-scope';

import { type CampaignAccess, resolveCampaignAccess } from '../lib/campaign-access';

/**
 * Resolves what the current member may do on one campaign page from the dashboard scope: the
 * member's `DATA_WRITE` capability and the platform of the store in scope. Only the top-level
 * list and detail clients call it; they hand the result to `CampaignAccessProvider`. The
 * resolver returns one of a few module-level constants, so the provided value keeps its
 * identity across renders without memoization. UX only: the backend enforces every permission.
 */
export function useResolvedCampaignAccess(page: WorkbookPage): CampaignAccess {
  const canWrite = useCan(CAPABILITIES.DATA_WRITE);
  const platform = useCurrentStore()?.platform ?? null;

  return resolveCampaignAccess({ canWrite, platform, page });
}
