'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getMe, type Me } from '../api/me.api';
import { meKeys } from '../query-keys';

/**
 * Fetches the authenticated user's profile (timezone, preferred
 * language, email). Cached under the `['me']` key; the session-expired
 * handler invalidates the whole cache on sign-out, so no manual reset
 * is needed here.
 */
export function useMe(): UseQueryResult<Me> {
  return useQuery<Me>({
    queryKey: meKeys.all,
    queryFn: getMe,
    staleTime: 1000 * 60 * 5,
  });
}
