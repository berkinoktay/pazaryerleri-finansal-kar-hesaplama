'use client';

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Notification03Icon,
  Pulse01Icon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NotificationEntry {
  id: string;
  icon: 'success' | 'warning' | 'info';
  title: string;
  timestamp: string;
  source?: string;
}

const ENTRY_ICON = {
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  info: Pulse01Icon,
} as const;

const ENTRY_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export interface NotificationBellProps {
  entries: NotificationEntry[];
  unreadCount: number;
}

/**
 * Bell trigger + Popover with last entries. Lives in PageHeader.actions.
 * Replaces the deprecated ActivityRail. Full history is at /notifications.
 */
export function NotificationBell({
  entries,
  unreadCount,
}: NotificationBellProps): React.ReactElement {
  const t = useTranslations('notificationBell');
  const display = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={t('label')} className="relative">
          <Notification03Icon className="size-icon-sm" />
          {unreadCount > 0 ? (
            <span
              className={cn(
                'right-3xs top-3xs text-2xs absolute flex min-w-4 items-center justify-center rounded-full px-1 font-semibold',
                'bg-warning text-warning-foreground',
              )}
              aria-label={`${unreadCount} okunmamış`}
            >
              {display}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {entries.length === 0 ? (
          <div className="p-md text-muted-foreground text-center text-sm">{t('empty')}</div>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="gap-xs p-sm flex flex-col">
              {entries.slice(0, 5).map((entry) => {
                const Icon = ENTRY_ICON[entry.icon];
                return (
                  <li key={entry.id} className="gap-xs p-xs flex items-start rounded-md text-sm">
                    <Icon className={cn('size-icon-sm mt-3xs shrink-0', ENTRY_TONE[entry.icon])} />
                    <div className="gap-3xs flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground truncate">{entry.title}</span>
                      <span className="text-2xs text-muted-foreground">
                        {entry.timestamp}
                        {entry.source ? ` · ${entry.source}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
        <Separator />
        <Link
          href="/notifications"
          className="text-primary hover:bg-muted px-sm py-xs block text-center text-sm font-medium"
        >
          {t('seeAll')}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
