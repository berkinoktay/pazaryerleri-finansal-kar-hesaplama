'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Two numeric inputs joined by an en-dash for an inclusive [min, max] range
 * (the `between` operator of a money / percent / number filter). A unit symbol
 * (₺ / %) renders as the leading slot of each field. For single-bound operators
 * (≥ / ≤ / =) the caller uses a plain Input instead — this widget is the dual
 * "between" editor only.
 *
 * @useWhen editing an inclusive numeric range (min–max) in a filter or form
 */

export interface RangeInputProps {
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  /** Leading unit symbol on each field. */
  unit?: '₺' | '%';
  /** `decimal` (money/percent) keeps the dot key; `numeric` (counts) hides it. */
  inputMode?: 'decimal' | 'numeric';
  size?: 'sm' | 'md' | 'lg';
  /** Localized aria-label + placeholder for the lower bound (e.g. "En az"). */
  minLabel: string;
  /** Localized aria-label + placeholder for the upper bound (e.g. "En çok"). */
  maxLabel: string;
  className?: string;
}

export function RangeInput({
  min,
  max,
  onMinChange,
  onMaxChange,
  unit,
  inputMode = 'decimal',
  size = 'sm',
  minLabel,
  maxLabel,
  className,
}: RangeInputProps): React.ReactElement {
  const leading = unit !== undefined ? <span className="text-xs">{unit}</span> : undefined;
  return (
    <div className={cn('gap-xs flex items-center', className)}>
      <Input
        size={size}
        inputMode={inputMode}
        value={min}
        onChange={(event) => onMinChange(event.target.value)}
        leading={leading}
        placeholder={minLabel}
        aria-label={minLabel}
        className="min-w-0 flex-1"
      />
      <span aria-hidden className="text-muted-foreground shrink-0 text-xs">
        –
      </span>
      <Input
        size={size}
        inputMode={inputMode}
        value={max}
        onChange={(event) => onMaxChange(event.target.value)}
        leading={leading}
        placeholder={maxLabel}
        aria-label={maxLabel}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
