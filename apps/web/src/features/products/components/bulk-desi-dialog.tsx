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

import { useBulkUpdateVariantDimensionalWeight } from '../hooks/use-bulk-update-variant-dimensional-weight';

import { BulkDesiForm } from './bulk-desi-form';

export interface BulkDesiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  storeId: string;
  variantIds: string[];
  /** Closes the host bulk-action selection (table.rowSelection) on success. */
  onClearSelection: () => void;
}

/**
 * Dialog launched from the bulk action bar's "Desi" action.
 *
 * Two operations in one surface (both in BulkDesiForm):
 *   - Primary: apply a single desi value to all selected variants.
 *   - Secondary: clear the override on all selected variants and fall back to
 *     each variant's marketplace-synced value.
 *
 * The parent opens this dialog through `open` (there is no DialogTrigger).
 * The form's draft lives inside DialogContent, which unmounts on close, so a
 * typed value or an inline error never survives into the next opening. The
 * mutation lives here instead, in the always-mounted host: dismissing the
 * dialog mid-save still ends with the toast and the cleared selection, and a
 * reopened dialog shows the save as still pending.
 */
export function BulkDesiDialog({
  open,
  onOpenChange,
  orgId,
  storeId,
  variantIds,
  onClearSelection,
}: BulkDesiDialogProps): React.ReactElement {
  const t = useTranslations('products.bulkDesi');
  const mutation = useBulkUpdateVariantDimensionalWeight();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Default modal width: the footer's three nowrap buttons ("reset all",
          cancel, apply) do not fit the narrow single-field width and pushed
          the content out of the card. */}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count: variantIds.length })}</DialogDescription>
        </DialogHeader>
        <BulkDesiForm
          orgId={orgId}
          storeId={storeId}
          variantIds={variantIds}
          mutation={mutation}
          inputId="bulk-desi-input"
          allowClearAll
          showHelp
          onDone={() => {
            onOpenChange(false);
            onClearSelection();
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
