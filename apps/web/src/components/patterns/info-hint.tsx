'use client';

import { InformationCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Inline "what does this mean?" affordance: a small ⓘ button beside a label that
 * reveals an explanation on hover / keyboard focus. Built on the shared Tooltip
 * primitive (portaled → never clipped, side-aware zoom). A generic atom — drop it
 * next to any stat label, table header, or form field; it is NOT stat-specific.
 *
 * The explanation is supplementary (the value it annotates is always visible), so
 * a hover/focus Tooltip is the right weight — light, keyboard-accessible, and
 * skipped on touch where the data still reads on its own. For a field whose
 * explanation is essential on touch, use a click Popover instead.
 *
 * The trigger is a real `<button>` (keyboard + screen-reader reachable) and stops
 * click propagation so a hint inside a clickable StatCard never triggers its
 * drill-down.
 *
 * @useWhen annotating a label with an optional explanation tooltip (use Popover for touch-critical or interactive content)
 */
export interface InfoHintProps {
  /** The explanation body (a sentence or node). */
  children: React.ReactNode;
  /** Optional bold lead line in the tooltip; also the icon's accessible name. */
  label?: string;
  /** Tooltip placement relative to the icon. Defaults to `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Extra classes on the ⓘ trigger button (e.g. alignment). */
  className?: string;
}

export function InfoHint({
  children,
  label,
  side = 'top',
  className,
}: InfoHintProps): React.ReactElement {
  const t = useTranslations('common');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ?? t('infoHint')}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'text-muted-foreground-dim hover:text-muted-foreground focus-visible:ring-ring duration-fast ease-out-quart inline-flex shrink-0 cursor-help items-center rounded-full align-middle transition-colors outline-none focus-visible:ring-2',
            className,
          )}
        >
          <InformationCircleIcon className="size-icon-xs" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-tooltip px-sm py-xs">
        {label ? <span className="text-foreground mb-3xs block font-semibold">{label}</span> : null}
        <span className="text-muted-foreground block leading-relaxed font-normal">{children}</span>
      </TooltipContent>
    </Tooltip>
  );
}
