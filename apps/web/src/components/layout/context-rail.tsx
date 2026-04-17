'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Refresh01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';

import { NAV_ITEMS } from '@/components/layout/nav-config';
import { StoreSwitcher, type Store } from '@/components/layout/store-switcher';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export interface ContextRailProps {
  stores: Store[];
  activeStoreId: string;
  onSelectStore: (id: string) => void;
  onAddStore?: () => void;
  onSyncNow?: () => void;
}

/**
 * Second column of the dual-rail shell. Changes shape based on the active
 * module (sub-nav), but the store switcher + quick actions stay constant
 * at top and bottom — the two places the user reaches for most often.
 */
export function ContextRail({
  stores,
  activeStoreId,
  onSelectStore,
  onAddStore,
  onSyncNow,
}: ContextRailProps): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations();

  const activeItem =
    NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ??
    NAV_ITEMS[0];

  return (
    <aside
      aria-label="Bağlam paneli"
      className="w-rail-context border-border bg-background flex h-full flex-col border-r"
    >
      <div className="gap-xs border-border p-sm flex flex-col border-b">
        <StoreSwitcher
          stores={stores}
          activeStoreId={activeStoreId}
          onSelect={onSelectStore}
          onAddStore={onAddStore}
        />
      </div>

      {activeItem?.sections?.length ? (
        <div className="px-sm py-sm flex items-center justify-between">
          <h2 className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
            {t(activeItem.labelKey)}
          </h2>
        </div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="gap-md px-sm pb-md flex flex-col">
          {activeItem?.sections?.map((section) => (
            <div key={section.key} className="gap-3xs flex flex-col">
              <span className="px-xs text-2xs text-muted-foreground font-medium tracking-wide uppercase">
                {section.label}
              </span>
              <ul className="gap-3xs flex flex-col">
                {section.items.map((sub) => {
                  const isActive = pathname === sub.href;
                  return (
                    <li key={sub.key}>
                      <Link
                        href={sub.href}
                        className={cn(
                          'gap-xs px-xs py-3xs duration-fast flex items-center justify-between rounded-md text-sm transition-colors',
                          'hover:bg-muted',
                          'focus-visible:outline-none',
                          isActive
                            ? 'bg-muted text-foreground font-medium'
                            : 'text-muted-foreground',
                        )}
                      >
                        <span>{sub.label}</span>
                        {sub.badge ? (
                          <span className="bg-accent px-xs py-3xs text-2xs text-accent-foreground rounded-full font-medium">
                            {sub.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <div className="gap-xs p-sm flex flex-col">
        <Button variant="outline" size="sm" onClick={onSyncNow} className="justify-start">
          <Refresh01Icon className="size-icon-sm" />
          Şimdi senkronize et
        </Button>
        <Button variant="ghost" size="sm" onClick={onAddStore} className="justify-start">
          <PlusSignIcon className="size-icon-sm" />
          Mağaza bağla
        </Button>
      </div>
    </aside>
  );
}
