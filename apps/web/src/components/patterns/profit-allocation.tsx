import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ProfitAllocationSegment } from '@/lib/build-profit-allocation';
import { cn } from '@/lib/utils';

/**
 * Shared presentation kit for the "satış nereye gitti" grouped profit allocation —
 * the stacked bar, the group rows (leaf + collapsible), and the key/value lines the
 * order profit sheet and the campaign profit dialogs both render. The DATA (group
 * totals) is backend-computed via {@link buildProfitAllocation}; these components only
 * lay it out. The per-surface line items (returns, micro-export, VAT sub-lines) stay
 * in each caller — only the neutral shells live here.
 */

/** The stacked composition bar: each group a slice whose width is its display share. */
export function AllocationBar({
  segments,
  label,
}: {
  segments: ProfitAllocationSegment[];
  label: string;
}): React.ReactElement {
  return (
    <div className="gap-3xs mt-sm flex h-3 w-full" role="img" aria-label={label}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className="rounded-xs"
          // runtime-dynamic: segment width = gösterim payı, renk = grup token'ı
          style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
        />
      ))}
    </div>
  );
}

/** Uppercase section eyebrow with an optional right-aligned total. */
export function AllocationSectionLabel({
  label,
  total,
}: {
  label: string;
  total?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </span>
      {total !== undefined ? (
        <span className="text-foreground text-xs font-medium tabular-nums">{total}</span>
      ) : null}
    </div>
  );
}

/** A label → value row (muted / emphasis variants) used inside groups and income lists. */
export function AllocationLine({
  label,
  children,
  muted = false,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  emphasis?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn(muted && 'text-muted-foreground', emphasis && 'font-semibold')}>
        {label}
      </span>
      <span className={cn('tabular-nums', emphasis && 'font-semibold')}>{children}</span>
    </div>
  );
}

/** A non-expandable group row (swatch + name + amount + share). */
export function AllocationGroupHeader({
  segment,
  name,
  pct,
  emphasize = false,
}: {
  segment: ProfitAllocationSegment;
  name: string;
  pct: (percent: number) => string;
  emphasize?: boolean;
}): React.ReactElement {
  return (
    <div className="gap-sm border-border-muted py-sm flex items-center border-t first:border-t-0">
      <GroupSwatch color={segment.color} />
      <span className={cn('text-sm font-medium', emphasize && 'text-success')}>{name}</span>
      <span
        className={cn('ml-auto text-sm font-semibold tabular-nums', emphasize && 'text-success')}
      >
        <Currency value={segment.amount} />
      </span>
      <span
        className={cn(
          'text-muted-foreground w-11 text-right text-sm tabular-nums',
          emphasize && 'text-success',
        )}
      >
        {pct(segment.percent)}
      </span>
    </div>
  );
}

/** An expandable group row; `children` are the group's line items. */
export function AllocationGroupCollapsible({
  segment,
  name,
  pct,
  children,
}: {
  segment: ProfitAllocationSegment;
  name: string;
  pct: (percent: number) => string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="gap-sm border-border-muted py-sm hover:bg-row-hover group flex w-full cursor-pointer items-center border-t transition-colors"
        >
          <GroupSwatch color={segment.color} />
          <span className="text-sm font-medium">{name}</span>
          <ArrowDown01Icon className="text-muted-foreground size-icon-xs transition-transform group-data-[state=open]:rotate-180" />
          <span className="ml-auto text-sm font-semibold tabular-nums">
            <Currency value={segment.amount} />
          </span>
          <span className="text-muted-foreground w-11 text-right text-sm tabular-nums">
            {pct(segment.percent)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="gap-3xs pl-lg pb-xs flex flex-col">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupSwatch({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-xs"
      // runtime-dynamic: grup rengi (chart/token) — swatch dolgusu
      style={{ backgroundColor: color }}
    />
  );
}
