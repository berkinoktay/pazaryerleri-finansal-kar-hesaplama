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
import { formatTrDecimal } from '@/lib/parse-tr-decimal';
import { cn } from '@/lib/utils';

import { useBulkUpdateVariantDimensionalWeight } from '../hooks/use-bulk-update-variant-dimensional-weight';
import {
  pickDimensionalWeightErrorCode,
  type DimensionalWeightErrorCode,
} from '../lib/dimensional-weight-errors';
import { parseDesiInput } from '../lib/dimensional-weight-input';

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
 *     The input is parsed the Turkish way ("2,5" and "2.5" both mean 2.5) and
 *     validated inline with the popover's rules; only a valid value is sent,
 *     as the dot string "2.5". An empty input is a format error here (use the
 *     clear action to remove overrides).
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
  const [errorCode, setErrorCode] = React.useState<DimensionalWeightErrorCode | null>(null);

  const mutation = useBulkUpdateVariantDimensionalWeight();

  // Reset on close, not on open: the parent opens this dialog through its
  // `open` prop (there is no DialogTrigger), and Radix calls onOpenChange only
  // to close it. Every close path (Cancel, X, Escape, outside click, a
  // successful apply) runs through here, so the next opening starts empty.
  function close() {
    setValue('');
    setErrorCode(null);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    close();
  }

  // `next` is null to clear every override, or the value to apply: `payload`
  // goes on the wire ("2.5"), `display` into the toast ("2,5").
  function submit(next: { payload: string; display: string } | null) {
    setErrorCode(null);
    mutation.mutate(
      { orgId, storeId, variantIds, dimensionalWeight: next?.payload ?? null },
      {
        onSuccess: (data) => {
          toast.success(
            next === null
              ? t('toast.cleared', { count: data.updated })
              : t('toast.applied', { count: data.updated, value: next.display }),
          );
          close();
          onClearSelection();
        },
        onError: (err) => {
          const code = pickDimensionalWeightErrorCode(err);
          if (code !== null) setErrorCode(code);
        },
      },
    );
  }

  function handleApply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseDesiInput(value);
    switch (parsed.kind) {
      case 'empty':
        setErrorCode('INVALID_DIMENSIONAL_WEIGHT_FORMAT');
        return;
      case 'invalid':
        setErrorCode(parsed.code);
        return;
      case 'valid':
        submit({ payload: parsed.payload, display: formatTrDecimal(parsed.value) });
        return;
      default: {
        const _exhaustive: never = parsed;
        throw new Error(`Unhandled desi input result: ${JSON.stringify(_exhaustive)}`);
      }
    }
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
                setErrorCode(null);
              }}
              aria-invalid={errorCode !== null}
              className={cn(
                'tabular-nums',
                errorCode !== null && 'border-destructive focus-visible:ring-destructive',
              )}
              disabled={mutation.isPending}
            />
            <p
              className={cn(
                'text-xs',
                errorCode !== null ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {errorCode !== null ? t(`errors.${errorCode}`) : t('help')}
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
                onClick={close}
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
