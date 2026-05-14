'use client';

import { Refresh01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';
import { useUpdateVariantDimensionalWeight } from '../hooks/use-update-variant-dimensional-weight';
import {
  pickDimensionalWeightErrorCode,
  type DimensionalWeightErrorCode,
} from '../lib/dimensional-weight-errors';

export interface DesiCellPopoverProps {
  orgId: string;
  storeId: string;
  variant: VariantSummary;
  children: React.ReactNode;
}

/**
 * Popover anchored to the desi cell. Edits the user override only; the
 * synced (marketplace) value is never written by this flow.
 *
 * Open → numeric input pre-filled with the current effective value.
 * Save  → mutation with optimistic cache patch.
 * Reset → same mutation with body { dimensionalWeight: null }, which
 *         clears the override and falls back to the synced value at the
 *         next read.
 */
export function DesiCellPopover({
  orgId,
  storeId,
  variant,
  children,
}: DesiCellPopoverProps): React.ReactElement {
  const t = useTranslations('products.desiCell.popover');
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<string>(variant.dimensionalWeight ?? '');
  const [serverErrorCode, setServerErrorCode] = React.useState<DimensionalWeightErrorCode | null>(
    null,
  );

  const mutation = useUpdateVariantDimensionalWeight();

  // Resync local state with the canonical value on every open transition.
  // Doing it in onOpenChange (instead of a useEffect-on-open) avoids the
  // cascading-render warning and is more honest about what's happening:
  // "opening" is a discrete event we react to, not state we sync from.
  function handleOpenChange(next: boolean) {
    if (next) {
      setValue(variant.dimensionalWeight ?? '');
      setServerErrorCode(null);
    }
    setOpen(next);
  }

  function commit(nextValue: string | null) {
    setServerErrorCode(null);
    mutation.mutate(
      { orgId, storeId, variantId: variant.id, dimensionalWeight: nextValue },
      {
        onSuccess: () => setOpen(false),
        onError: (err) => {
          const code = pickDimensionalWeightErrorCode(err);
          if (code !== null) setServerErrorCode(code);
        },
      },
    );
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    commit(trimmed === '' ? null : trimmed);
  }

  function handleReset() {
    commit(null);
  }

  const showSyncedHint =
    variant.syncedDimensionalWeight !== null && variant.syncedDimensionalWeight !== value.trim();

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-0">
        <form onSubmit={handleSave} className="p-md gap-sm flex flex-col" noValidate>
          <div className="gap-2xs flex flex-col">
            <label htmlFor={`desi-${variant.id}`} className="text-foreground text-sm font-semibold">
              {t('title')}
            </label>
            <Input
              id={`desi-${variant.id}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
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
            />
            {serverErrorCode !== null ? (
              <p className="text-destructive text-xs">{t(`errors.${serverErrorCode}`)}</p>
            ) : showSyncedHint ? (
              <p className="text-muted-foreground text-xs tabular-nums">
                {t('syncedHint', { value: variant.syncedDimensionalWeight ?? '' })}
              </p>
            ) : null}
          </div>

          <div className="gap-xs flex items-center justify-between">
            {variant.isDimensionalWeightOverridden ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={mutation.isPending}
                className="gap-2xs text-muted-foreground hover:text-foreground"
              >
                <Refresh01Icon className="size-icon-xs" />
                {t('reset')}
              </Button>
            ) : (
              <span />
            )}
            <div className="gap-xs flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {t('save')}
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
