'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { NAV_ITEMS, type NavItem } from '@/components/layout/nav-config';
import { StoreSwitcher, type Store } from '@/components/layout/store-switcher';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface MobileNavSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: Store[];
  activeStoreId: string;
  onSelectStore: (id: string) => void;
  onAddStore?: () => void;
}

/**
 * Slide-over drawer triggered by the MobileTopBar hamburger. Hosts the
 * primary nav items, the store switcher, and the page-specific sub-nav
 * (mirroring the desktop ContextRail) so mobile users have parity with
 * the three-column shell.
 */
export function MobileNavSheet({
  open,
  onOpenChange,
  stores,
  activeStoreId,
  onSelectStore,
  onAddStore,
}: MobileNavSheetProps): React.ReactElement {
  const t = useTranslations();
  const tSheet = useTranslations('mobileNavSheet');
  const pathname = usePathname();

  const activeItem: NavItem | undefined = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-sm">
          <SheetTitle>{tSheet('title')}</SheetTitle>
        </SheetHeader>

        {stores.length > 0 ? (
          <div className="px-sm pb-sm">
            <StoreSwitcher
              stores={stores}
              activeStoreId={activeStoreId}
              onSelect={(id) => {
                onSelectStore(id);
                onOpenChange(false);
              }}
              onAddStore={onAddStore}
            />
          </div>
        ) : null}

        <nav className="px-sm gap-3xs flex flex-col">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  'gap-xs px-xs py-xs duration-fast flex items-center rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  isActive ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-icon-sm" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        {activeItem && 'sections' in activeItem && activeItem.sections ? (
          <div className="px-sm py-md gap-md flex flex-col border-t">
            {activeItem.sections.map((section) => (
              <SubNavList
                key={section.key}
                headingKey={section.labelKey}
                currentHref={pathname}
                items={section.items}
              />
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
