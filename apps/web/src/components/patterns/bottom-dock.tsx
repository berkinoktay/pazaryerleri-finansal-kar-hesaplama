import * as React from 'react';

import { cn } from '@/lib/utils';

export interface BottomDockProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Sticky utility cluster at the bottom of the dashboard sidebar.
 * Hosts Support / Settings / Theme toggle / User row.  Pattern is
 * structurally minimal — content is composed by the AppShell so this
 * component stays i18n-agnostic.
 *
 * Padding shrinks in icon-collapsed mode so the contained
 * SidebarMenuButtons sit flush in the 48px column. Inner items
 * already collapse via `group-data-[collapsible=icon]` on their own
 * primitives — the dock just provides the right outer chrome.
 *
 * @useWhen anchoring sticky utility links (support, settings, theme toggle, user row) to the bottom of the sidebar
 */
export function BottomDock({ children, className }: BottomDockProps): React.ReactElement {
  return (
    <div
      className={cn(
        // bg-sidebar (not bg-background) so the dock continues the
        // rail surface uninterrupted. The earlier bg-background paint
        // produced a jarring white box at the bottom of the rail
        // whenever --sidebar diverged from --background — caught in
        // post-Tiyasis-redesign review.
        'border-sidebar-border bg-sidebar gap-3xs p-xs flex flex-col border-t',
        'group-data-[collapsible=icon]:px-3xs',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Dashed separator inside the dock.  Use sparingly to delineate
 * utility links from the user row. Hidden in collapsed-icon mode so
 * the icon column reads as a single tight stack instead of fragmented
 * rows separated by stray horizontal lines.
 */
function BottomDockDivider(): React.ReactElement {
  return (
    <hr
      role="separator"
      className="border-border my-3xs border-t border-dashed group-data-[collapsible=icon]:hidden"
    />
  );
}

BottomDock.Divider = BottomDockDivider;
