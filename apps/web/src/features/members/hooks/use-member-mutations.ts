'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import {
  setMemberStoreAccess,
  updateMemberRole,
  type Member,
  type MemberRole,
} from '../api/members.api';
import { membersKeys } from './members-keys';

interface UpdateRoleVars {
  memberId: string;
  role: MemberRole;
}

/**
 * Change a member's role. VALIDATION_ERROR (e.g. last-owner guard) is silenced
 * globally; the dialog reads `mutation.error` to render the inline message.
 */
export function useUpdateMemberRole(
  orgId: string,
): UseMutationResult<Member, Error, UpdateRoleVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: UpdateRoleVars) => updateMemberRole(orgId, memberId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKeys.list(orgId) });
    },
  });
}

interface SetStoreAccessVars {
  memberId: string;
  storeIds: string[];
}

/** Replace a member's store-access grant set. */
export function useSetMemberStoreAccess(
  orgId: string,
): UseMutationResult<Member, Error, SetStoreAccessVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, storeIds }: SetStoreAccessVars) =>
      setMemberStoreAccess(orgId, memberId, storeIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKeys.list(orgId) });
    },
  });
}
