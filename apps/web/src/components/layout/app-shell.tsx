'use client';

import * as React from 'react';

import { ContextRail } from '@/components/layout/context-rail';
import { IconRail } from '@/components/layout/icon-rail';
import { type Store } from '@/components/layout/store-switcher';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  /**
   * Organisation picker rendered at the top of the ContextRail.
   * Passed as a ReactNode so the shell stays dumb — the fetching,
   * cookie handling, and create-org modal live in the feature layer.
   */
  orgSwitcher?: React.ReactNode;
  stores?: Store[];
  activeStoreId?: string;
  onSelectStore?: (id: string) => void;
  onAddStore?: () => void;
  children: React.ReactNode;
}

/**
 * Three-column workspace shell — IconRail (48px) · ContextRail (220px,
 * sheet under md) · Content (1fr). Each page owns its own header via
 * <PageHeader>; the shell does not provide an app-level top bar.
 *
 * The notification bell lives in PageHeader actions, not in the shell.
 * On screens narrower than md, the IconRail and ContextRail are hidden
 * and replaced by a MobileNavSheet triggered from a top bar.
 */
export function AppShell({
  orgSwitcher,
  stores = [],
  activeStoreId,
  onSelectStore,
  onAddStore,
  children,
}: AppShellProps): React.ReactElement {
  return (
    <div className="bg-background text-foreground grid h-full grid-cols-[auto_auto_1fr] grid-rows-1 overflow-hidden">
      <div className="hidden md:block">
        <IconRail />
      </div>

      <div className="hidden md:block">
        <ContextRail
          orgSwitcher={orgSwitcher}
          stores={stores}
          activeStoreId={activeStoreId ?? ''}
          onSelectStore={onSelectStore ?? (() => undefined)}
          onAddStore={onAddStore}
        />
      </div>

      <main
        id="main"
        className={cn('relative min-w-0 overflow-y-auto', 'focus-visible:outline-none')}
      >
        <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex flex-col">{children}</div>
      </main>
    </div>
  );
}
