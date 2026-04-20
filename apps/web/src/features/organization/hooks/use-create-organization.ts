'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { setActiveOrgIdAction } from '@/lib/active-org-actions';

import {
  createOrganization,
  type CreateOrganizationBody,
  type OrganizationCreatedResponse,
} from '../api/create-organization.api';
import { organizationKeys } from '../query-keys';

/**
 * Create an organization and make the caller its OWNER. On success:
 *   1. Persist the new org id as `last_org_id` cookie (via Server Action)
 *      so the dashboard redirect picks it up on the next render.
 *   2. Invalidate the organizations list so the switcher rebuilds.
 *   3. Toast-notify the user — the switcher + URL don't always signal
 *      "it worked" loudly enough (especially when the modal opener is
 *      still covering the shell).
 *   4. `router.refresh()` so the RSC layout re-reads the cookie and
 *      re-fetches the org list; `router.push('/dashboard')` ensures
 *      the onboarding-page flow lands users at the dashboard, while
 *      the dashboard-modal flow becomes a no-op URL-wise.
 */
export function useCreateOrganization(): UseMutationResult<
  OrganizationCreatedResponse,
  Error,
  CreateOrganizationBody
> {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tToast = useTranslations('organizations.create.toast');

  return useMutation<OrganizationCreatedResponse, Error, CreateOrganizationBody>({
    mutationFn: createOrganization,
    onSuccess: async (created) => {
      await setActiveOrgIdAction(created.id);
      await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
      toast.success(tToast('success', { name: created.name }));
      router.push('/dashboard');
      router.refresh();
    },
    onError: () => {
      toast.error(tToast('error'));
    },
  });
}
