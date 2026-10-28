'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { archiveCostProfile } from '../api/archive-cost-profile.api';
import type { CostProfile } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

interface ArchiveArgs {
  orgId: string;
  profileId: string;
}

/**
 * Mutation hook for archiving a cost profile (soft-delete).
 *
 * Invalidation matrix (spec §7.6):
 *   - profile(id) — archivedAt is now set
 *   - profiles() — archived profiles are filtered from the default list view
 *   - All variantAttachments — archived profiles are excluded from popover combobox
 *
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useArchiveCostProfile() {
  const queryClient = useQueryClient();

  return useMutation<CostProfile, Error, ArchiveArgs>({
    mutationFn: ({ orgId, profileId }) => archiveCostProfile(orgId, profileId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: costsKeys.profile(variables.profileId) });
      void queryClient.invalidateQueries({ queryKey: costsKeys.profiles(variables.orgId) });
      // Invalidate all variant attachments — archived profile drops from combobox
      void queryClient.invalidateQueries({ queryKey: [...costsKeys.all, 'variant'] });
      // An archived profile no longer counts as a cost, so the products list's cost tab
      // and the missing-cost banner change with it.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: costsKeys.missingCostStats(variables.orgId) });
    },
  });
}
