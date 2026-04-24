'use client';

import * as React from 'react';

import { ContextRail } from '@/components/layout/context-rail';
import { IconRail } from '@/components/layout/icon-rail';
import { MobileNavSheet } from '@/components/layout/mobile-nav-sheet';
import { MobileTopBar } from '@/components/layout/mobile-top-bar';
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
 * <PageHeader>; the shell does not provide an app-level top bar above md.
 *
 * Below md: IconRail + ContextRail are hidden and replaced by a
 * MobileTopBar (hamburger trigger + brand + bell + user menu). Tapping
 * the hamburger opens MobileNavSheet (a slide-over drawer that hosts
 * the same nav + store switcher + sub-nav as the rails).
 */
export function AppShell({
  orgSwitcher,
  stores = [],
  activeStoreId,
  onSelectStore,
  onAddStore,
  children,
}: AppShellProps): React.ReactElement {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="bg-background text-foreground flex h-full flex-col overflow-hidden md:grid md:grid-cols-[auto_auto_1fr] md:grid-rows-1">
      <MobileTopBar onOpenNav={() => setMobileNavOpen(true)} />
      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        stores={stores}
        activeStoreId={activeStoreId ?? ''}
        onSelectStore={onSelectStore ?? (() => undefined)}
        onAddStore={onAddStore}
      />

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
        className={cn('relative min-w-0 flex-1 overflow-y-auto', 'focus-visible:outline-none')}
      >
        <div className="max-w-content-max gap-lg px-sm py-sm md:px-lg md:py-lg mx-auto flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
