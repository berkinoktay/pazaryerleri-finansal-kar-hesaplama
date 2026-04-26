'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import type { NavItemBadge } from '@/components/layout/nav-config';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { SidebarMenuAction, SidebarMenuButton, useSidebar } from '@/components/ui/sidebar';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NavGroupProps {
  /** Display label, already translated by the caller. */
  label: string;
  /** Icon node — sidebar primitives auto-size icons via [&>svg] selectors. */
  icon: React.ReactNode;
  /** Inline badge — Yeni / Beta / count indicator. */
  badge?: NavItemBadge;
  /** Parent route the header navigates to (e.g. `/orders`).
   *  Used in collapsed-sidebar mode where a sub-item drawer makes no sense
   *  and clicking the icon should drop the user into the section's default
   *  view — same place the chevron would have led after one expand. */
  href: string;
  /** Whether the section's parent route (or one of its children) is active.
   *  Drives both the SidebarMenuButton's `isActive` styling and the
   *  default-expanded behavior on first paint. */
  isActive?: boolean;
  /** Open the children body on first paint when truthy. */
  defaultExpanded?: boolean;
  /** Sub-route links rendered inside the collapsible body. */
  children: React.ReactNode;
  className?: string;
}

const BADGE_TONE: Record<NavItemBadge['variant'], NonNullable<BadgeProps['tone']>> = {
  count: 'warning',
  new: 'success',
  beta: 'neutral',
};

/**
 * Expandable nav group — header (SidebarMenuButton) + collapsible body.
 *
 * Rendered the way shadcn's collapsible sidebar examples do it: the
 * header is a Link to the parent route so it works as a real navigation
 * target in BOTH expanded and collapsed sidebar modes (collapsed mode
 * cannot show a sub-list). A separate SidebarMenuAction button on the
 * right toggles the body open/closed when the sidebar is expanded; in
 * icon mode that action button is hidden entirely and the body is
 * collapsed-out via `group-data-[collapsible=icon]:hidden`.
 *
 * Animation: `grid-template-rows: 0fr → 1fr` per apps/web/CLAUDE.md
 * motion guidance — `height` transitions trigger layout on every frame
 * and are banned.
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
}: NavGroupProps): React.ReactElement {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  // In collapsed-sidebar mode the body is hidden by CSS, but we also
  // want to suppress the toggle action button so the only interaction
  // is the parent-route Link. Keep React state honest with what's
  // visually possible.
  const bodyVisible = !collapsed && expanded;

  return (
    <div className={cn('flex flex-col', className)}>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link href={href}>
          {icon}
          <span>{label}</span>
          {badge ? (
            <Badge
              tone={BADGE_TONE[badge.variant]}
              size="sm"
              className="ml-auto group-data-[collapsible=icon]:hidden"
            >
              {badge.label}
            </Badge>
          ) : null}
        </Link>
      </SidebarMenuButton>
      <SidebarMenuAction
        type="button"
        aria-label={`${label} alt menüsünü ${expanded ? 'kapat' : 'aç'}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="duration-fast hover:bg-muted hover:text-foreground transition-colors group-data-[collapsible=icon]:hidden"
      >
        <ArrowDown01Icon
          className={cn(
            'size-icon-xs duration-fast transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </SidebarMenuAction>
      <div
        className={cn(
          'duration-base ease-out-quart grid transition-[grid-template-rows]',
          'group-data-[collapsible=icon]:hidden',
          bodyVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
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
