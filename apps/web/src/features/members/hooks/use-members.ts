'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listMembers, type Member } from '../api/members.api';
import { membersKeys } from './members-keys';

/** Org roster. Disabled until an org is resolved. */
export function useMembers(orgId: string | null): UseQueryResult<Member[]> {
  return useQuery({
    queryKey: orgId !== null ? membersKeys.list(orgId) : [...membersKeys.lists(), '__disabled__'],
    queryFn: () => {
      if (orgId === null) throw new Error('useMembers called with null orgId');
      return listMembers(orgId);
    },
    enabled: orgId !== null,
  });
}
