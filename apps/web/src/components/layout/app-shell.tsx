'use client';

import * as React from 'react';

import { ActivityRail, type ActivityEntry } from '@/components/layout/activity-rail';
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
  onSyncNow?: () => void;
  onAddStore?: () => void;
  activity?: ActivityEntry[];
  children: React.ReactNode;
}

/**
 * Dual-rail workspace shell — the single most distinctive structural
 * element of PazarSync.
 *
 * Columns: IconRail (48px) · ContextRail (240px, sheet under 900px) ·
 * Content (1fr) · ActivityRail (32px → 320px).
 *
 * This is the default shell for every authenticated route. The page
 * itself owns its header via <PageHeader> — there is deliberately no
 * app-level top bar, keeping the content area starting at the top edge.
 */
export function AppShell({
  orgSwitcher,
  stores = [],
  activeStoreId,
  onSelectStore,
  onSyncNow,
  onAddStore,
  activity = [],
  children,
}: AppShellProps): React.ReactElement {
  return (
    <div className="bg-background text-foreground grid h-full grid-cols-[auto_auto_1fr_auto] grid-rows-1 overflow-hidden">
      <IconRail />

      <div className="hidden md:block">
        <ContextRail
          orgSwitcher={orgSwitcher}
          stores={stores}
          activeStoreId={activeStoreId ?? ''}
          onSelectStore={onSelectStore ?? (() => undefined)}
          onAddStore={onAddStore}
          onSyncNow={onSyncNow}
        />
      </div>

      <main
        id="main"
        className={cn('relative min-w-0 overflow-y-auto', 'focus-visible:outline-none')}
      >
        <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex flex-col">{children}</div>
      </main>

      <div className="hidden lg:block">
        <ActivityRail entries={activity} />
      </div>
    </div>
  );
}
