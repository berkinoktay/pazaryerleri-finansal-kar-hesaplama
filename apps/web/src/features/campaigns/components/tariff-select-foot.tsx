'use client';

import { Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TariffSelectFootProps {
  /** Whether this option is the seller's current choice. */
  selected: boolean;
  /** Label when not selected — e.g. "Bu aralığı seç" / "Bu fiyatı seç". */
  label: string;
  /** Label when selected — "Seçildi". */
  selectedLabel: string;
  /**
   * When provided, the foot is a REAL `<button>` — used by the custom-price card,
   * which has no click-anywhere overlay (its input would fight one), so this is the
   * explicit commit. Omit for the preset bands: their card overlay owns the click,
   * and the foot is then a purely visual indicator (a `<span>`) below it.
   */
  onToggle?: () => void;
  /** Only meaningful with `onToggle` — disables the button until a choice is valid. */
  disabled?: boolean;
}

/**
 * The shared select indicator every priced option ends with — an empty radio ring
 * (not selected) that swaps for a same-size filled tick disc + "Seçildi" (selected),
 * in the brand tone. Pinned to the bottom (`mt-auto`) so the controls line up across
 * a row of equal-height cards. Renders as a `<button>` when interactive, else a
 * decorative `<span>` (the band overlay handles that click).
 */
export function TariffSelectFoot({
  selected,
  label,
  selectedLabel,
  onToggle,
  disabled = false,
}: TariffSelectFootProps): React.ReactElement {
  const indicator = selected ? (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-full"
    >
      <Tick02Icon className="size-2.5" strokeWidth={3} />
    </span>
  ) : (
    <span aria-hidden className="border-border-strong size-4 shrink-0 rounded-full border-2" />
  );
  const text = selected ? selectedLabel : label;
  const base = cn(
    'gap-2xs text-2xs mt-auto flex items-center font-semibold',
    selected ? 'text-primary-soft-foreground' : 'text-muted-foreground',
  );

  // Visual only — the band card's stretched overlay owns the click.
  if (onToggle === undefined) {
    return (
      <span className={base}>
        {indicator}
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        base,
        'duration-fast cursor-pointer rounded-md transition-colors',
        'focus-visible:shadow-focus focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {indicator}
      {text}
    </button>
  );
}
