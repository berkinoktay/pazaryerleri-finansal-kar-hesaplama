'use client';

import { Refresh01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTrDecimal } from '@/lib/parse-tr-decimal';
import { cn } from '@/lib/utils';

import type { BulkDesiMutation } from '../hooks/use-bulk-update-variant-dimensional-weight';
import {
  pickDimensionalWeightErrorCode,
  type DimensionalWeightErrorCode,
} from '../lib/dimensional-weight-errors';
import { parseDesiInput } from '../lib/dimensional-weight-input';

export interface BulkDesiFormProps {
  orgId: string;
  storeId: string;
  /** Every variant the value is applied to. */
  variantIds: string[];
  /**
   * Owned by the host, which stays mounted for the whole save: a dialog
   * dismissed mid-save, or a parent-row cell whose optimistic update swaps
   * its content, must not lose the pending state or the save's outcome.
   */
  mutation: BulkDesiMutation;
  /** Unique per mounted form: ties the visible label to the input. */
  inputId: string;
  /**
   * Shows the secondary "reset all to the Trendyol value" action. The bulk
   * dialog offers it; the parent-row popover does not (it only opens when no
   * variant has a desi, so there is no entered value to remove).
   */
  allowClearAll: boolean;
  /** Shows the "overwrites the Trendyol value" note under the field. */
  showHelp: boolean;
  /**
   * Runs after a successful save, once the toast is shown, even when the
   * form has unmounted meanwhile.
   */
  onDone: () => void;
  onCancel: () => void;
}

/**
 * One desi value for many variants, shared by the bulk desi dialog (selected
 * rows) and the parent-row popover (every variant of one product).
 *
 * The input is parsed the Turkish way ("2,5" and "2.5" both mean 2.5) and
 * validated inline with the same rules as the single-variant popover; only a
 * valid value is sent, as the dot string "2.5". An empty input is a format
 * error here: clearing goes through the explicit reset action.
 *
 * The form keeps its own draft state. Its hosts render it inside
 * DialogContent / PopoverContent, which unmount on close, so every opening
 * starts empty.
 */
export function BulkDesiForm({
  orgId,
  storeId,
  variantIds,
  mutation,
  inputId,
  allowClearAll,
  showHelp,
  onDone,
  onCancel,
}: BulkDesiFormProps): React.ReactElement {
  const t = useTranslations('products.bulkDesi');
  const count = variantIds.length;
  const [value, setValue] = React.useState('');
  const [errorCode, setErrorCode] = React.useState<DimensionalWeightErrorCode | null>(null);

  // `next` is null to clear every override, or the value to apply: `payload`
  // goes on the wire ("2.5"), `display` into the toast ("2,5").
  //
  // mutateAsync, not mutate(..., { onSuccess }): TanStack drops per-call
  // callbacks once the calling component unmounts, and this form can unmount
  // mid-save (a dialog dismissed with Escape). The promise settles anyway, so
  // the toast and onDone always run.
  async function submit(next: { payload: string; display: string } | null): Promise<void> {
    setErrorCode(null);
    try {
      const data = await mutation.mutateAsync({
        orgId,
        storeId,
        variantIds,
        dimensionalWeight: next?.payload ?? null,
      });
      toast.success(
        next === null
          ? t('toast.cleared', { count: data.updated })
          : t('toast.applied', { count: data.updated, value: next.display }),
      );
      onDone();
    } catch (err) {
      // Not swallowed: the global MutationCache onError already toasts every
      // code it does not silence; this only adds the inline message for the
      // desi validation codes (VALIDATION_ERROR is silenced globally).
      const code = pickDimensionalWeightErrorCode(err);
      if (code !== null) setErrorCode(code);
    }
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
        void submit({ payload: parsed.payload, display: formatTrDecimal(parsed.value) });
        return;
      default: {
        const _exhaustive: never = parsed;
        throw new Error(`Unhandled desi input result: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  const message = errorCode !== null ? t(`errors.${errorCode}`) : showHelp ? t('help') : null;

  return (
    <form onSubmit={handleApply} noValidate className="gap-sm flex flex-col">
      <div className="gap-2xs flex flex-col">
        <label htmlFor={inputId} className="text-foreground text-xs font-medium">
          {t('fieldLabel')}
        </label>
        <Input
          id={inputId}
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
        {message !== null ? (
          <p
            className={cn(
              'text-xs',
              errorCode !== null ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {message}
          </p>
        ) : null}
      </div>

      {/* flex-wrap: a longer label (another locale, a bigger count) wraps the
          actions to a second row instead of overflowing the dialog. */}
      <div className="gap-xs flex flex-wrap items-center justify-end">
        {allowClearAll ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void submit(null)}
            disabled={mutation.isPending}
            className="gap-2xs text-muted-foreground hover:text-foreground mr-auto"
          >
            <Refresh01Icon className="size-icon-xs" />
            {t('clearAll')}
          </Button>
        ) : null}
        <div className="gap-xs flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {t('apply', { count })}
          </Button>
        </div>
      </div>
    </form>
  );
}
