'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { setActiveOrgIdAction } from '@/lib/active-org-actions';
import { ApiError } from '@/lib/api-error';

import {
  createOrganization,
  type CreateOrganizationBody,
  type OrganizationCreatedResponse,
} from '../api/create-organization.api';
import { organizationKeys } from '../query-keys';

/**
 * Create an organization and make the caller its OWNER. On success:
 *   1. Persist the new org id as `last_org_id` cookie (via Server Action).
 *   2. Invalidate the organizations list so the switcher rebuilds.
 *   3. Toast-notify the user.
 *   4. Route to /onboarding/connect-store so the user can connect
 *      their first marketplace account. If they skip, the dashboard
 *      shows an empty-state CTA to connect later.
 *
 * On VALIDATION_ERROR we suppress the toast — the form component reads
 * `mutation.error.problem.errors` and projects each entry into
 * `form.setError(field, ...)` so the per-field inline UI lights up.
 *
 * `meta.silent` stops the global QueryProvider MutationCache onError
 * from also toasting; we own the user-visible feedback in this hook.
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
      router.push('/onboarding/connect-store');
      router.refresh();
    },
    onError: (error) => {
      // Validation errors are surfaced inline by the form (field-level).
      // Skip the toast; the form walks `problem.errors` and calls
      // `form.setError` itself.
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') return;
      toast.error(tToast('error'));
    },
    meta: { silent: true },
  });
}
