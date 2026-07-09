'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createCostProfile, type CreateCostProfileArgs } from '../api/create-cost-profile.api';
import type { CostProfile } from '../types/cost-profile.types';

import { costsKeys } from './costs-keys';

/**
 * Mutation hook for creating a cost profile.
 *
 * Invalidation: profiles() — the new profile must appear in the list.
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function useCreateCostProfile() {
  const queryClient = useQueryClient();

  return useMutation<CostProfile, Error, CreateCostProfileArgs>({
    mutationFn: createCostProfile,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: costsKeys.profiles(variables.orgId) });
    },
  });
}
