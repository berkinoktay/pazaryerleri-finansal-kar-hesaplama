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
 */
export function BottomDock({ children, className }: BottomDockProps): React.ReactElement {
  return (
    <div
      className={cn('border-border bg-background gap-3xs p-xs flex flex-col border-t', className)}
    >
      {children}
    </div>
  );
}

/**
 * Dashed separator inside the dock.  Use sparingly to delineate
 * utility links from the user row.
 */
function BottomDockDivider(): React.ReactElement {
  return <hr role="separator" className="border-border my-3xs border-t border-dashed" />;
}

BottomDock.Divider = BottomDockDivider;
