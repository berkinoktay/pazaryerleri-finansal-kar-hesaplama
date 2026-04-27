'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import type { NavItemBadge } from '@/components/layout/nav-config';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { SidebarMenuButton, useSidebar } from '@/components/ui/sidebar';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NavGroupProps {
  /** Display label, already translated by the caller. */
  label: string;
  /** Icon node — sidebar primitives auto-size icons via [&>svg] selectors. */
  icon: React.ReactNode;
  /** Inline badge — Yeni / Beta / count indicator. */
  badge?: NavItemBadge;
  /** Parent route the row navigates to (e.g. `/orders`). Always navigates;
   *  the same click also toggles the sub-list expanded state. */
  href: string;
  /** Whether the section's parent route (or one of its children) is active.
   *  Drives both the active-row styling and the default-expanded behavior
   *  on first paint. */
  isActive?: boolean;
  /** Open the children body on first paint when truthy. */
  defaultExpanded?: boolean;
  /** Sub-route links rendered inside the collapsible body. */
  children: React.ReactNode;
  className?: string;
  /** Extra classes forwarded to the SidebarMenuButton trigger row.
   *  Used by AppShell to apply the consumer-level active-state primary
   *  fill (`data-[active=true]:bg-primary …`) without forking the
   *  Sidebar primitive. */
  buttonClassName?: string;
}

const BADGE_TONE: Record<NavItemBadge['variant'], NonNullable<BadgeProps['tone']>> = {
  count: 'warning',
  new: 'success',
  beta: 'neutral',
};

/**
 * Expandable nav group — entire row navigates AND toggles sub-list.
 *
 * The row is one big clickable target: clicking anywhere on it (label,
 * icon, chevron) navigates to the parent route via Link AND flips the
 * expanded state for the sub-list. This matches the standard SaaS sidebar
 * pattern (Linear, Stripe, Notion) where the parent row is itself a real
 * navigation target — clicking should never feel like "nothing happened".
 *
 * Sub-list animates open via `grid-template-rows: 0fr → 1fr` per
 * apps/web/CLAUDE.md motion guidance — `height` transitions trigger
 * layout on every frame and are banned. The grid wrapper is hidden via
 * `group-data-[collapsible=icon]:hidden` so the icon-only sidebar mode
 * never shows the body (no room for it).
 *
 * Tooltip in icon mode: `SidebarMenuButton` already wires Radix Tooltip
 * via its `tooltip` prop — no manual TooltipProvider needed.
 */
export function NavGroup({
  label,
  icon,
  badge,
  href,
  isActive = false,
  defaultExpanded = false,
  children,
  className,
  buttonClassName,
}: NavGroupProps): React.ReactElement {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  // Body visibility honors both the user's expand/collapse intent AND the
  // sidebar's icon-collapsed mode — the latter wins because there's no
  // room to render sub-items in 48px.
  const bodyVisible = !collapsed && expanded;

  return (
    <div className={cn('flex flex-col', className)}>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label} className={buttonClassName}>
        <Link
          href={href}
          aria-expanded={!collapsed ? expanded : undefined}
          onClick={() => {
            // Always toggle on click. The Link still navigates — these
            // happen together. When the user is on a sub-route and clicks
            // the parent, the navigation goes to the parent route AND the
            // sub-list reveals (which it likely already was, since defaultExpanded
            // was true for the active section).
            setExpanded((prev) => !prev);
          }}
        >
          {icon}
          <span className="flex-1">{label}</span>
          {badge ? (
            <Badge
              tone={BADGE_TONE[badge.variant]}
              size="sm"
              radius="sm"
              className="group-data-[collapsible=icon]:hidden"
            >
              {badge.label}
            </Badge>
          ) : null}
          <ArrowDown01Icon
            className={cn(
              'size-icon-xs duration-fast shrink-0 transition-transform',
              'group-data-[collapsible=icon]:hidden',
              isActive ? 'text-primary-foreground' : 'text-muted-foreground',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </Link>
      </SidebarMenuButton>
      <div
        className={cn(
          'duration-base ease-out-quart grid transition-[grid-template-rows]',
          'group-data-[collapsible=icon]:hidden',
          bodyVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          {/*
            Sub-list wrapper:
              - py-xs (8px) gives the first/last items breathing room from
                the parent row (previous py-3xs/2px felt cramped).
              - gap-2xs (4px) between items spaces the rows comfortably.
              - The left line is rendered as an absolutely positioned 1px
                bg-border span instead of a `border-l` so we control its
                vertical inset (top/bottom) — gives a "branch" feel that
                doesn't run flush to the parent row's edges.
          */}
          <div className="ml-md pl-md py-xs gap-2xs relative flex flex-col">
            <span aria-hidden className="bg-border top-2xs bottom-2xs absolute left-0 w-px" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
