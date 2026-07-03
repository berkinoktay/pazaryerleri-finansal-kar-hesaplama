'use client';

import { CheckmarkCircle02Icon, CircleIcon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TariffSelectControlProps {
  /** Whether this option is the seller's current choice. */
  selected: boolean;
  /** Disable selecting (e.g. no calculable estimate yet). A selected control stays clickable to deselect. */
  disabled?: boolean;
  onToggle: () => void;
  /** Label shown when NOT selected — e.g. "Plus'e Katıl", "Bu fiyatı seç". */
  label: string;
  /** Label shown when selected — e.g. "Katıldın", "Bu fiyat seçildi". */
  selectedLabel: string;
  className?: string;
}

/**
 * The one, shared selection affordance for every tariff choice — a radio-style
 * toggle button (outline circle → checked circle) with a label. Every selectable
 * option (the Plus offer, a custom price, and — later — a commission band) uses THIS
 * distinct button rather than a click-anywhere card overlay: the overlay fights the
 * custom-price input, so a single explicit control keeps the interaction consistent
 * and unambiguous across the row.
 */
export function TariffSelectControl({
  selected,
  disabled = false,
  onToggle,
  label,
  selectedLabel,
  className,
}: TariffSelectControlProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'gap-2xs text-2xs duration-fast ease-out-quart px-xs py-2xs flex cursor-pointer items-center self-start rounded-md border font-medium transition-colors',
        'focus-visible:shadow-focus focus-visible:outline-none',
        'disabled:cursor-not-allowed',
        selected
          ? 'border-primary text-primary bg-surface-row-selected'
          : 'border-border text-foreground hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent',
        className,
      )}
    >
      {selected ? (
        <CheckmarkCircle02Icon className="text-primary size-4 shrink-0" aria-hidden />
      ) : (
        <CircleIcon className="text-border-strong size-4 shrink-0" aria-hidden />
      )}
      {selected ? selectedLabel : label}
    </button>
  );
}
