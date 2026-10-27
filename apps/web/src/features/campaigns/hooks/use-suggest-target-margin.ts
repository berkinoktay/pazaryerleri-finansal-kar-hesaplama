'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  suggestTargetMargin,
  type TargetMarginBody,
  type TargetMarginResult,
} from '../api/suggest-target-margin.api';

/**
 * Mutation hook for the target-margin price suggester. Pure compute — writes nothing, so
 * there is no cache invalidation; the caller puts the suggestions into its local edit buffer
 * and only `useUpdateCampaignSelections` persists them. No custom onError — the global
 * pipeline toasts.
 */
export function useSuggestTargetMargin(
  orgId: string,
  storeId: string,
  campaignId: string,
): UseMutationResult<TargetMarginResult, Error, TargetMarginBody> {
  return useMutation<TargetMarginResult, Error, TargetMarginBody>({
    mutationFn: (body) => suggestTargetMargin(orgId, storeId, campaignId, body),
  });
}
