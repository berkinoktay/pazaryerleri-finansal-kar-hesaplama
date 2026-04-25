'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import type { NavItemBadge } from '@/components/layout/nav-config';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface NavGroupProps {
  label: string;
  icon: React.ReactNode;
  badge?: NavItemBadge;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Map a NavItemBadge variant to the Badge primitive's `tone` token.
 * `count` reads as warning-ish (attention), `new` as success (fresh
 * positive), `beta` as neutral (quiet).  All four semantic surfaces
 * already exist in tokens/colors.css — no new colors introduced.
 */
const BADGE_TONE: Record<NavItemBadge['variant'], NonNullable<BadgeProps['tone']>> = {
  count: 'warning',
  new: 'success',
  beta: 'neutral',
};

/**
 * Expandable nav group — header button + collapsible body.  Used in
 * the single sidebar to host nested feature routes (Karlılık Analizi,
 * Maliyet & Araçlar).  Animation uses `grid-template-rows: 0fr → 1fr`
 * per apps/web/CLAUDE.md motion guidance — `height` transitions are
 * banned because they trigger layout on every frame.
 */
export function NavGroup({
  label,
  icon,
  badge,
  defaultExpanded = false,
  children,
  className,
}: NavGroupProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'gap-xs px-xs py-3xs duration-fast flex items-center rounded-sm text-xs transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        )}
      >
        <span className="size-icon-sm shrink-0" aria-hidden>
          {icon}
        </span>
        <span className="flex-1 text-left">{label}</span>
        {badge ? (
          <Badge tone={BADGE_TONE[badge.variant]} size="sm">
            {badge.label}
          </Badge>
        ) : null}
        <ArrowDown01Icon
          className={cn(
            'size-icon-xs duration-fast shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          'duration-base ease-out-quart grid transition-[grid-template-rows]',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-border ml-md pl-xs py-3xs gap-3xs flex flex-col border-l">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
