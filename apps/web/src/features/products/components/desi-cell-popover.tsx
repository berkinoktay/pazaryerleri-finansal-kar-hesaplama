'use client';

import Decimal from 'decimal.js';
import { Refresh01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatTrDecimal } from '@/lib/parse-tr-decimal';
import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';
import { useUpdateVariantDimensionalWeight } from '../hooks/use-update-variant-dimensional-weight';
import {
  pickDimensionalWeightErrorCode,
  type DimensionalWeightErrorCode,
} from '../lib/dimensional-weight-errors';
import { parseDesiInput } from '../lib/dimensional-weight-input';

export interface DesiCellPopoverProps {
  orgId: string;
  storeId: string;
  variant: VariantSummary;
  children: React.ReactNode;
}

/**
 * The editing string the input opens with: empty for a variant with no desi
 * (null on the wire), otherwise the effective value in Turkish format ("1.50"
 * opens as "1,5"; a real 0 opens as "0"). Formatted with the locale-fixed tr
 * formatter, never next-intl's: the field's convention is Turkish whatever the
 * UI locale.
 */
function initialInputValue(variant: VariantSummary): string {
  if (variant.dimensionalWeight === null) return '';
  return formatTrDecimal(variant.dimensionalWeight);
}

/** Trendyol's desi; null when Trendyol sent none (its 0 is stored as null too). */
function syncedDesi(variant: VariantSummary): Decimal | null {
  if (variant.syncedDimensionalWeight === null) return null;
  return new Decimal(variant.syncedDimensionalWeight);
}

/**
 * Popover anchored to the desi cell. Edits the user override only; the
 * synced (marketplace) value is never written by this flow.
 *
 * Open: the input is pre-filled (see initialInputValue). Below it, a note
 *   says Trendyol has no desi for the product when the synced value is
 *   empty; otherwise the synced value (0 included) is shown for reference
 *   while the input differs from it.
 * Save: the input is parsed the Turkish way ("1,5" and "1.5" both mean 1.5)
 *   and validated inline; only a valid value is sent, as the dot string
 *   "1.5". An empty input clears the override.
 * Reset: the same mutation with body { dimensionalWeight: null }, which
 *   clears the override and falls back to the synced value at the next read
 *   (back to missing desi when Trendyol has none).
 */
export function DesiCellPopover({
  orgId,
  storeId,
  variant,
  children,
}: DesiCellPopoverProps): React.ReactElement {
  const t = useTranslations('products.desiCell.popover');
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<string>(() => initialInputValue(variant));
  const [errorCode, setErrorCode] = React.useState<DimensionalWeightErrorCode | null>(null);

  const mutation = useUpdateVariantDimensionalWeight();

  // Resync local state with the canonical value on every open transition.
  // Doing it in onOpenChange (instead of a useEffect-on-open) avoids the
  // cascading-render warning and is more honest about what's happening:
  // "opening" is a discrete event we react to, not state we sync from.
  function handleOpenChange(next: boolean) {
    if (next) {
      setValue(initialInputValue(variant));
      setErrorCode(null);
    }
    setOpen(next);
  }

  function commit(nextValue: string | null) {
    setErrorCode(null);
    mutation.mutate(
      { orgId, storeId, variantId: variant.id, dimensionalWeight: nextValue },
      {
        onSuccess: () => setOpen(false),
        onError: (err) => {
          const code = pickDimensionalWeightErrorCode(err);
          if (code !== null) setErrorCode(code);
        },
      },
    );
  }

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseDesiInput(value);
    switch (parsed.kind) {
      case 'empty':
        commit(null);
        return;
      case 'valid':
        commit(parsed.payload);
        return;
      case 'invalid':
        setErrorCode(parsed.code);
        return;
      default: {
        const _exhaustive: never = parsed;
        throw new Error(`Unhandled desi input result: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  function handleReset() {
    commit(null);
  }

  const synced = syncedDesi(variant);
  const parsedInput = parseDesiInput(value);
  const inputMatchesSynced =
    synced !== null && parsedInput.kind === 'valid' && parsedInput.value.eq(synced);

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
                setErrorCode(null);
              }}
              aria-invalid={errorCode !== null}
              className={cn(
                'tabular-nums',
                errorCode !== null && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            {errorCode !== null ? (
              <p className="text-destructive text-xs">{t(`errors.${errorCode}`)}</p>
            ) : synced === null ? (
              <p className="text-muted-foreground text-xs">{t('syncedMissing')}</p>
            ) : inputMatchesSynced ? null : (
              <p className="text-muted-foreground text-xs tabular-nums">
                {t('syncedHint', { value: formatTrDecimal(synced) })}
              </p>
            )}
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
