'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Wordmark } from '@/components/brand/wordmark';
import { NAV_ITEMS } from '@/components/layout/nav-config';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Primary icon rail — 48px wide, icon-only. Every icon is tooltipped with
 * its Turkish label so the visual-only surface is keyboard/screen-reader
 * accessible. Active item gets a solid surface + tinted icon; others are
 * muted until hover.
 */
export function IconRail(): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <nav
      aria-label="Ana gezinme"
      className="w-rail-icon gap-xs border-border bg-card py-sm flex h-full flex-col items-center border-r"
    >
      <Link
        href="/dashboard"
        className="flex size-8 items-center justify-center rounded-md focus-visible:outline-none"
        aria-label="PazarSync"
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

      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mt-auto flex size-9 items-center justify-center rounded-md focus-visible:outline-none"
            aria-label="Kullanıcı menüsü"
          >
            <Avatar className="size-7">
              <AvatarFallback>BO</AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Kullanıcı</TooltipContent>
      </Tooltip>
    </nav>
  );
}
