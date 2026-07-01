'use client';

import { MinusSignIcon, PlusSignIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  TABLE_SCALE_DEFAULT,
  TABLE_SCALE_MAX,
  TABLE_SCALE_MIN,
  TABLE_SCALE_STEP,
  clampTableScale,
} from '@/lib/table-scale';
import { cn } from '@/lib/utils';

export interface TableScaleControlProps {
  /** Current scale (1 = full size). */
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

// At a bound, the step button is disabled: fade it via opacity and re-enable
// pointer events so the cursor reads `not-allowed` (the Button base sets
// `disabled:pointer-events-none`, which would suppress the cursor). Native
// `disabled` still blocks the click.
const STEP_DISABLED =
  'disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Density stepper for a zoomable DataTable — a single bordered segment control:
 * `[−] %90 [+]`. Shrinks the table's rows/cells so a wide table fits without
 * horizontal scroll (the scaling itself is the DataTable `scale` prop; this is
 * just the control). The center reading doubles as a "reset to 100%" button.
 */
export function TableScaleControl({
  value,
  onChange,
  className,
}: TableScaleControlProps): React.ReactElement {
  const t = useTranslations('common.tableScale');
  const format = useFormatter();

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn(
        // pointer-coarse: grow to a 44px touch target (matches BulkActionBar +
        // the sort headers) so the steppers don't fail the touch-target floor.
        'border-border bg-card inline-flex h-8 items-center rounded-md border pointer-coarse:h-11',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('size-8 rounded-none rounded-l-md pointer-coarse:size-11', STEP_DISABLED)}
        aria-label={t('decrease')}
        disabled={value <= TABLE_SCALE_MIN}
        onClick={() => onChange(clampTableScale(value - TABLE_SCALE_STEP))}
      >
        <MinusSignIcon aria-hidden />
      </Button>
      <button
        type="button"
        onClick={() => onChange(TABLE_SCALE_DEFAULT)}
        aria-label={t('reset')}
        title={t('reset')}
        className="border-border hover:bg-muted focus-visible:bg-muted flex h-full min-w-11 items-center justify-center border-x text-xs font-medium tabular-nums transition-colors focus-visible:outline-none"
      >
        {format.number(value, 'percentInt')}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn('size-8 rounded-none rounded-r-md pointer-coarse:size-11', STEP_DISABLED)}
        aria-label={t('increase')}
        disabled={value >= TABLE_SCALE_MAX}
        onClick={() => onChange(clampTableScale(value + TABLE_SCALE_STEP))}
      >
        <PlusSignIcon aria-hidden />
      </Button>
    </div>
  );
}
