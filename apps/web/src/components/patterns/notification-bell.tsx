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
import { CountBadge } from '@/components/ui/count-badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SidebarMenuButton } from '@/components/ui/sidebar';
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

/**
 * Shared collapsed/expanded sizing for a sidebar-row trigger — mirrors the
 * AppShell's NAV_ITEM_CLASSES sizing (40px collapsed target, 20px icon,
 * label hidden in icon mode) so the footer bell row lines up pixel-for-pixel
 * with the nav rows above it.
 */
const SIDEBAR_TRIGGER_CLASSES = cn(
  'relative h-9 [&>svg]:size-icon-lg!',
  'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1.5!',
  'group-data-[collapsible=icon]:justify-center',
  // NB: do NOT blanket-hide child spans here (`[&>span]:hidden`) — that also
  // hid the collapsed count badge, which IS a child span that must stay
  // visible in icon mode. The label span hides itself instead (below).
);

export interface NotificationBellProps {
  entries: NotificationEntry[];
  unreadCount: number;
  /**
   * `icon` (default): compact outline icon-button for PageHeader.actions and
   * the mobile header. `sidebar`: full-width labelled row (icon + "Bildirimler"
   * + count) for the desktop sidebar footer — opens the same popover to the
   * right of the rail.
   */
  variant?: 'icon' | 'sidebar';
}

/**
 * Bell trigger + Popover with the latest entries. Full history is at
 * /notifications. The unread count clamps to "9+" past 9; the popover shows
 * the 5 most-recent entries with a "see all" link.
 *
 * Two surfaces, one popover body:
 *   - `icon`    — PageHeader.actions / mobile header (outline icon button)
 *   - `sidebar` — desktop sidebar footer utility row (labelled, opens right)
 *
 * @useWhen mounting a notification surface — high-frequency events (sync results, alerts) — in PageHeader.actions (icon) or the sidebar footer (sidebar); full history lives at /notifications
 */
export function NotificationBell({
  entries,
  unreadCount,
  variant = 'icon',
}: NotificationBellProps): React.ReactElement {
  const t = useTranslations('notificationBell');
  const display = unreadCount > 9 ? '9+' : String(unreadCount);
  const isSidebar = variant === 'sidebar';

  return (
    <Popover>
      <PopoverTrigger asChild>
        {isSidebar ? (
          <SidebarMenuButton
            aria-label={t('label')}
            tooltip={t('label')}
            className={SIDEBAR_TRIGGER_CLASSES}
          >
            <Notification03Icon />
            <span className="flex-1 text-left group-data-[collapsible=icon]:hidden">
              {t('label')}
            </span>
            {unreadCount > 0 ? (
              <>
                {/* Expanded: inline count pill on the right. */}
                <CountBadge
                  tone="destructive"
                  animate
                  className="ml-auto group-data-[collapsible=icon]:hidden"
                >
                  {display}
                </CountBadge>
                {/* Collapsed: badge pinned to the bell-icon corner (kept inside
                    the 40px button bounds so the menu-button overflow-hidden
                    doesn't clip it); ring matches the rail so it reads as a dot. */}
                <CountBadge
                  tone="destructive"
                  animate
                  className="ring-sidebar absolute top-1 right-1 hidden ring-2 group-data-[collapsible=icon]:flex"
                >
                  {display}
                </CountBadge>
              </>
            ) : null}
          </SidebarMenuButton>
        ) : (
          <Button variant="outline" size="icon-sm" aria-label={t('label')} className="relative">
            <Notification03Icon className="size-icon-sm" />
            {unreadCount > 0 ? (
              <CountBadge tone="destructive" animate className="right-3xs top-3xs absolute">
                {display}
              </CountBadge>
            ) : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={isSidebar ? 'right' : undefined}
        align="end"
        sideOffset={isSidebar ? 8 : undefined}
        className="w-80 p-0"
      >
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
