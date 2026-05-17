'use client';

import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { statusToVisual } from '@/features/shipping/lib/shipping-estimate-status';
import { cn } from '@/lib/utils';

import { NetProfitPopover, type NetProfitPopoverData } from './net-profit-popover';

/**
 * Semantic surface + foreground per status color. Defined as a Record
 * (not a switch) so the cell stays config-driven and one new color
 * variant becomes one new entry.
 *
 * The choice of token pairs mirrors the rest of the design system —
 * `<tone>-surface` for chip backgrounds, `text-<tone>` for icon text.
 * Gray is intentionally `bg-muted` + `text-muted-foreground` rather
 * than a non-existent `gray-surface`.
 */
const ICON_CLASSES: Record<'blue' | 'yellow' | 'red' | 'gray', string> = {
  blue: 'bg-info-surface text-info',
  yellow: 'bg-warning-surface text-warning',
  red: 'bg-destructive-surface text-destructive',
  gray: 'bg-muted text-muted-foreground',
};

interface NetProfitCellProps {
  data: NetProfitPopoverData;
}

/**
 * Cell content for the "Tahmini Net Kar" products column.
 *
 * Two surface modes:
 *   - OK:     green-tinted net profit number + colored status icon → popover
 *             shows the breakdown
 *   - non-OK: muted "—" + colored status icon → popover shows the reason +
 *             a CTA Link (or a disabled chip for OWN_CONTRACT_EMPTY)
 *
 * The trigger is a `<button>` so the popover responds to keyboard focus
 * and pointer-coarse taps — same affordance pattern as `CostCell`.
 */
export function NetProfitCell({ data }: NetProfitCellProps): React.ReactElement {
  const visual = statusToVisual(data.status);
  const iconClass = ICON_CLASSES[visual.iconColor];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="gap-xs hover:bg-muted/60 duration-fast inline-flex h-7 cursor-pointer items-center rounded-sm px-2 transition-colors"
        >
          {data.status === 'OK' && data.netProfit !== null ? (
            <Currency value={data.netProfit} className="text-success text-sm font-semibold" />
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
          <span
            aria-hidden
            className={cn(
              'text-2xs inline-flex size-4 shrink-0 items-center justify-center rounded-full leading-none font-semibold',
              iconClass,
            )}
          >
            {visual.iconChar}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-dropdown-popover">
        <NetProfitPopover {...data} />
      </PopoverContent>
    </Popover>
  );
}
