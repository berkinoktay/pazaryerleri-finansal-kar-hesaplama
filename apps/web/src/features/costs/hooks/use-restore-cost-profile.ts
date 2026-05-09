'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { restoreCostProfile } from '../api/restore-cost-profile.api';
import type { CostProfile } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

interface RestoreArgs {
  orgId: string;
  profileId: string;
}

/**
 * Mutation hook for restoring an archived cost profile.
 *
 * Invalidation matrix (spec §7.6):
 *   - profile(id) — archivedAt is now null
 *   - profiles() — restored profile re-appears in the default list view
 *   - All variantAttachments — restored profile becomes selectable in combobox
 *
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useRestoreCostProfile() {
  const queryClient = useQueryClient();

  return useMutation<CostProfile, Error, RestoreArgs>({
    mutationFn: ({ orgId, profileId }) => restoreCostProfile(orgId, profileId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: costsKeys.profile(variables.profileId) });
      void queryClient.invalidateQueries({ queryKey: costsKeys.profiles() });
      // Invalidate all variant attachments — restored profile re-enters combobox
      void queryClient.invalidateQueries({ queryKey: [...costsKeys.all, 'variant'] });
    },
  });
}
