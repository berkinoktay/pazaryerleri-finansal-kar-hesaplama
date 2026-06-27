'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { getMyPreferences, updateMyPreferences, type Preferences } from '../api/preferences.api';

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const preferenceKeys = {
  all: ['preferences'] as const,
} as const;

// ---------------------------------------------------------------------------
// useMyPreferences — read
// ---------------------------------------------------------------------------

/**
 * Fetches the authenticated user's preferences (including marginColoring
 * when configured). Cached with a 5-minute staleTime. Silent — display-only;
 * any failure is cosmetic and should not interrupt the user with a toast.
 */
export function useMyPreferences(): UseQueryResult<Preferences> {
  return useQuery<Preferences>({
    queryKey: preferenceKeys.all,
    queryFn: getMyPreferences,
    staleTime: 1000 * 60 * 5,
    meta: { silent: true },
  });
}

// ---------------------------------------------------------------------------
// useUpdateMyPreferences — write
// ---------------------------------------------------------------------------

/**
 * Mutations that update the user's preferences via PATCH /v1/me/preferences.
 * On success, invalidates the preferences cache so any consumer re-renders
 * with fresh data. The global MutationCache onError handles toast notification
 * for non-silent failures.
 */
export function useUpdateMyPreferences(): UseMutationResult<Preferences, Error, Preferences> {
  const queryClient = useQueryClient();

  return useMutation<Preferences, Error, Preferences>({
    mutationFn: updateMyPreferences,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: preferenceKeys.all });
    },
  });
}
