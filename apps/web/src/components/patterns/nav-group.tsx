'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import type { NavItemBadge } from '@/components/layout/nav-config';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  /** Parent route the row navigates to (e.g. `/tools/commission-rates`). In
   *  expanded mode the same click toggles the sub-list. */
  href: string;
  /** Whether the section's parent route (or a child) is active — drives the
   *  active-row styling and the default-expanded behavior on first paint. */
  isActive?: boolean;
  /** Open the children body on first paint when truthy (expanded mode). */
  defaultExpanded?: boolean;
  /** Sub-route links — rendered inline (expanded) or in the flyout (collapsed). */
  children: React.ReactNode;
  className?: string;
  /** Extra classes for the SidebarMenuButton trigger row — used by AppShell
   *  to apply the branch-active styling without forking the primitive. */
  buttonClassName?: string;
}

export const NAV_BADGE_TONE: Record<NavItemBadge['variant'], NonNullable<BadgeProps['tone']>> = {
  count: 'warning',
  new: 'success',
  beta: 'neutral',
};

/**
 * Expandable nav group with two presentations:
 *
 *   - EXPANDED rail — the whole row navigates AND toggles an inline accordion
 *     body (`grid-template-rows: 0fr → 1fr`, never `height`, per motion rules).
 *     The active child carries the primary-soft surface; this parent shows
 *     brand text/icon only (branch-active) — no left guide line, pure indent.
 *
 *   - COLLAPSED (icon-only) rail — the accordion has no room, so clicking the
 *     icon opens a flyout Popover to the RIGHT listing the sub-routes. Hovering
 *     still shows the label tooltip. The flyout is controlled and closes on
 *     navigation (pathname change) so it doesn't linger after a pick.
 *
 * @useWhen rendering a primary sidebar nav row that has children (sub-routes) — inline accordion when expanded, right-side flyout when the rail is collapsed
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
  const [flyoutOpen, setFlyoutOpen] = React.useState(false);

  const badgeNode = badge ? (
    <Badge
      tone={NAV_BADGE_TONE[badge.variant]}
      size="sm"
      radius="sm"
      className="group-data-[collapsible=icon]:hidden"
    >
      {badge.label}
    </Badge>
  ) : null;

  if (collapsed) {
    return (
      <Popover open={flyoutOpen} onOpenChange={setFlyoutOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            isActive={isActive}
            tooltip={label}
            aria-label={label}
            className={buttonClassName}
          >
            {icon}
            <span className="flex-1">{label}</span>
            {badgeNode}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          onClick={() => setFlyoutOpen(false)}
          className="gap-3xs p-2xs flex w-52 flex-col"
        >
          <span className="px-xs pt-3xs pb-2xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
            {label}
          </span>
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        aria-label={label}
        className={buttonClassName}
      >
        <Link
          href={href}
          aria-expanded={expanded}
          onClick={() => {
            // Navigate (Link) AND toggle the sub-list together — the standard
            // SaaS pattern where the parent row is itself a real destination.
            setExpanded((prev) => !prev);
          }}
        >
          {icon}
          <span className="flex-1">{label}</span>
          {badgeNode}
          <ArrowDown01Icon
            className={cn(
              'size-icon-xs duration-fast shrink-0 transition-transform',
              isActive ? 'text-sidebar-active-foreground' : 'text-muted-foreground',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </Link>
      </SidebarMenuButton>
      <div
        className={cn(
          'duration-base ease-out-quart grid transition-[grid-template-rows]',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          {/*
            Sub-list wrapper: indentation ONLY (ml-md) — no left guide line.
            The owner rejected the left-accent / left-border motif (design
            spec D2) and the design system bans side-stripe borders outright.
            The active child carries a primary-soft surface (bg-sidebar-active),
            so the hierarchy reads without a rule. py-xs / gap-2xs keep the rows
            breathing.
          */}
          <div className="ml-md py-xs gap-2xs flex flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}
