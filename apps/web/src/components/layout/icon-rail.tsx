'use client';

import { useTranslations } from 'next-intl';

import { Wordmark } from '@/components/brand/wordmark';
import { NAV_ITEMS } from '@/components/layout/nav-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UserMenu } from '@/features/auth/components/user-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Primary icon rail — 48px wide, icon-only. Every icon is tooltipped with
 * its localized label so the visual-only surface is keyboard/screen-reader
 * accessible.
 */
export function IconRail(): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations();
  const tRail = useTranslations('iconRail');

  return (
    <nav
      aria-label={tRail('ariaLabel')}
      className="w-rail-icon gap-xs border-border bg-card py-sm flex h-full flex-col items-center border-r"
    >
      <Link
        href="/dashboard"
        className="flex size-8 items-center justify-center rounded-md focus-visible:outline-none"
        aria-label={tRail('brandAriaLabel')}
      >
        <Wordmark withText={false} />
      </Link>

      <div className="mt-sm gap-3xs flex flex-1 flex-col items-center">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Tooltip key={item.key} delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={cn(
                    'duration-fast flex size-9 items-center justify-center rounded-md transition-colors',
                    'text-muted-foreground hover:bg-muted hover:text-foreground',
                    'focus-visible:outline-none',
                    isActive && 'bg-accent text-primary hover:bg-accent',
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="size-icon" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="mt-auto">
        <UserMenu />
      </div>
    </nav>
  );
}
