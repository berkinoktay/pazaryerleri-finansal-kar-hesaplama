'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { CostProfile } from '../types/cost-profile.types';
import { useCreateCostProfile } from '../hooks/use-create-cost-profile';
import { useUpdateCostProfile } from '../hooks/use-update-cost-profile';
import type { CostProfileFormValues } from '../validation/cost-profile.schema';

import { CostProfileForm, profileToFormValues } from './cost-profile-form';

interface CostProfileCreateDialogProps {
  orgId: string;
  /**
   * The store a NEW profile is created under (cost profiles are store-scoped).
   * Required for the create path; unused when editing (storeId is immutable).
   */
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, the dialog acts as an edit dialog, pre-filling the form with the
   * profile's current values and calling PATCH instead of POST on submit.
   */
  editProfile?: CostProfile | null;
  /**
   * Called with the created or updated profile after a successful submit.
   * Useful for auto-attaching the new profile (PR 9 inline-create flow).
   */
  onSuccess?: (profile: CostProfile) => void;
}

/**
 * Dialog wrapping `CostProfileForm` for both create and edit flows.
 *
 * - Create: opened from the Costs page CTA or the cost-cell popover "+ Yeni"
 * - Edit: opened from the table row actions "Düzenle"
 *
 * On success, closes itself and calls `onSuccess(profile)` if provided.
 * No custom onError — the global QueryProvider error pipeline handles toasting.
 */
export function CostProfileCreateDialog({
  orgId,
  storeId,
  open,
  onOpenChange,
  editProfile,
  onSuccess,
}: CostProfileCreateDialogProps): React.ReactElement {
  const t = useTranslations('costs');
  const isEditing = editProfile !== null && editProfile !== undefined;

  const createMutation = useCreateCostProfile();
  const updateMutation = useUpdateCostProfile();

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(values: CostProfileFormValues) {
    // The API types use `manualFxRate?: string` (optional, not null).
    // The form uses `string | null` to distinguish "cleared" from "untouched".
    // Adapt here: null → omit the field entirely.
    const apiBody = {
      ...values,
      manualFxRate: values.manualFxRate !== null ? values.manualFxRate : undefined,
      note: values.note !== null ? values.note : undefined,
    };

    if (isEditing && editProfile !== null && editProfile !== undefined) {
      updateMutation.mutate(
        { orgId, profileId: editProfile.id, body: apiBody },
        {
          onSuccess: (updated) => {
            onOpenChange(false);
            onSuccess?.(updated);
          },
        },
      );
    } else {
      createMutation.mutate(
        { orgId, body: { ...apiBody, storeId } },
        {
          onSuccess: (created) => {
            onOpenChange(false);
            onSuccess?.(created);
          },
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-modal">
        <DialogHeader>
          <DialogTitle>{isEditing ? editProfile?.name : t('createDialog.title')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('form.fields.note') : t('createDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <CostProfileForm
          orgId={orgId}
          initialValues={
            isEditing && editProfile !== null ? profileToFormValues(editProfile) : undefined
          }
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}
