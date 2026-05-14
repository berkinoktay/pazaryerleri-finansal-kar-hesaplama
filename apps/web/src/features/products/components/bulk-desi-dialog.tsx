'use client';

import { Refresh01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { useBulkUpdateVariantDimensionalWeight } from '../hooks/use-bulk-update-variant-dimensional-weight';
import {
  pickDimensionalWeightErrorCode,
  type DimensionalWeightErrorCode,
} from '../lib/dimensional-weight-errors';

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
 * Two operations in one surface:
 *   - Primary (the form):  apply a single desi value to all selected variants.
 *   - Secondary (footer):  clear the override on all selected variants and
 *     fall back to each variant's marketplace-synced value.
 *
 * Clearing is wired as a secondary affordance rather than a separate dialog
 * because the destination is the same selection; the destructive tone on
 * the button is the only signal needed.
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
  const count = variantIds.length;
  const [value, setValue] = React.useState('');
  const [serverErrorCode, setServerErrorCode] = React.useState<DimensionalWeightErrorCode | null>(
    null,
  );

  const mutation = useBulkUpdateVariantDimensionalWeight();

  function handleOpenChange(next: boolean) {
    if (next) {
      setValue('');
      setServerErrorCode(null);
    }
    onOpenChange(next);
  }

  function submit(nextValue: string | null) {
    setServerErrorCode(null);
    mutation.mutate(
      { orgId, storeId, variantIds, dimensionalWeight: nextValue },
      {
        onSuccess: (data) => {
          toast.success(
            nextValue === null
              ? t('toast.cleared', { count: data.updated })
              : t('toast.applied', { count: data.updated, value: nextValue }),
          );
          onOpenChange(false);
          onClearSelection();
        },
        onError: (err) => {
          const code = pickDimensionalWeightErrorCode(err);
          if (code !== null) setServerErrorCode(code);
        },
      },
    );
  }

  function handleApply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') {
      setServerErrorCode('INVALID_DIMENSIONAL_WEIGHT_FORMAT');
      return;
    }
    submit(trimmed);
  }

  function handleClearAll() {
    submit(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-input-narrow">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleApply} noValidate className="gap-sm flex flex-col">
          <div className="gap-2xs flex flex-col">
            <label htmlFor="bulk-desi-input" className="text-foreground text-xs font-medium">
              {t('fieldLabel')}
            </label>
            <Input
              id="bulk-desi-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder={t('placeholder')}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setServerErrorCode(null);
              }}
              aria-invalid={serverErrorCode !== null}
              className={cn(
                'tabular-nums',
                serverErrorCode !== null && 'border-destructive focus-visible:ring-destructive',
              )}
              disabled={mutation.isPending}
            />
            <p
              className={cn(
                'text-xs',
                serverErrorCode !== null ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {serverErrorCode !== null ? t(`errors.${serverErrorCode}`) : t('help')}
            </p>
          </div>

          <DialogFooter className="gap-xs sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={mutation.isPending}
              className="gap-2xs text-muted-foreground hover:text-foreground"
            >
              <Refresh01Icon className="size-icon-xs" />
              {t('clearAll')}
            </Button>
            <div className="gap-xs flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {t('apply', { count })}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
