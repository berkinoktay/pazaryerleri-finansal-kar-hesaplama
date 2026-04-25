'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { NAV_ITEMS, type NavItem } from '@/components/layout/nav-config';
import { StoreSwitcher, type Store } from '@/components/layout/store-switcher';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePathname } from '@/i18n/navigation';

const DashboardContextMiddle = React.lazy(
  () => import('@/features/dashboard/components/dashboard-context-middle'),
);

export interface ContextRailProps {
  orgSwitcher?: React.ReactNode;
  stores: Store[];
  activeStoreId: string;
  onSelectStore: (id: string) => void;
  onAddStore?: () => void;
}

/**
 * Second column of the 3-rail shell. Top: org + prominent store
 * switcher. Middle: page-specific (sub-nav, or a custom component
 * via meta). No bottom — utility actions (sync, language, theme)
 * moved to PageHeader actions and UserMenu respectively.
 */
export function ContextRail({
  orgSwitcher,
  stores,
  activeStoreId,
  onSelectStore,
  onAddStore,
}: ContextRailProps): React.ReactElement {
  const pathname = usePathname();
  const tRail = useTranslations('contextRail');

  const activeItem: NavItem | undefined = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <aside
      aria-label={tRail('ariaLabel')}
      className="w-rail-context border-border bg-background flex h-full flex-col border-r"
    >
      <div className="gap-xs border-border p-sm flex flex-col border-b">
        {orgSwitcher}
        <StoreSwitcher
          stores={stores}
          activeStoreId={activeStoreId}
          onSelect={onSelectStore}
          onAddStore={onAddStore}
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="gap-md px-sm py-md flex flex-col">
          {activeItem?.meta === 'dashboard' ? (
            <React.Suspense fallback={null}>
              <DashboardContextMiddle />
            </React.Suspense>
          ) : null}
          {activeItem && 'sections' in activeItem && activeItem.sections
            ? activeItem.sections.map((section) => (
                <SubNavList
                  key={section.key}
                  headingKey={section.labelKey}
                  currentHref={pathname}
                  items={section.items}
                />
              ))
            : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
