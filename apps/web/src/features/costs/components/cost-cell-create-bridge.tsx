'use client';

import * as React from 'react';

import { CostProfileCreateDialog } from '@/features/costs/components/cost-profile-create-dialog';
import { useAttachCostProfiles } from '@/features/costs/hooks/use-attach-cost-profiles';
import type { CostProfile } from '@/features/costs/types/cost-profile.types';

export interface CostCellCreateBridgeProps {
  orgId: string;
  /** Store the new profile is created under — the variant's store (store-scoped). */
  storeId: string;
  variantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Thin wrapper that opens `CostProfileCreateDialog` and on success
 * auto-attaches the newly created profile to the current variant.
 *
 * Flow:
 *   1. User clicks "+ Yeni maliyet oluştur" in the cost-cell popover.
 *   2. Popover closes, this bridge opens the dialog.
 *   3. On dialog submit success → `useAttachCostProfiles` fires with the
 *      new profile id + current variant id.
 *   4. Dialog closes. Cache for `costsKeys.variantAttachments(variantId)`
 *      is invalidated by the attach hook, refreshing the popover on next open.
 *
 * Lives in the `costs` feature — cost-profile attach/create is a costs-domain
 * primitive consumed cross-feature (products cost cell, live-performance
 * missing-cost). See scripts/audit-feature-boundaries.config.ts (`costs` allow).
 */
export function CostCellCreateBridge({
  orgId,
  storeId,
  variantId,
  open,
  onOpenChange,
}: CostCellCreateBridgeProps): React.ReactElement {
  const attachMutation = useAttachCostProfiles();

  function handleSuccess(profile: CostProfile) {
    attachMutation.mutate({
      orgId,
      profileIds: [profile.id],
      variantIds: [variantId],
    });
  }

  return (
    <CostProfileCreateDialog
      orgId={orgId}
      storeId={storeId}
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={handleSuccess}
    />
  );
}
