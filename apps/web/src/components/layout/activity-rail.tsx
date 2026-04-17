'use client';

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Notification03Icon,
  Pulse01Icon,
  SidebarRightIcon,
} from 'hugeicons-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export interface ActivityEntry {
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

export interface ActivityRailProps {
  entries: ActivityEntry[];
}

/**
 * Right rail — collapsed to 32px by default showing only status glyphs,
 * expands to 320px on trigger to reveal the full activity feed. Tuck
 * ambient context (sync progress, recent webhooks) here so it never
 * competes with the primary content for attention.
 */
export function ActivityRail({ entries }: ActivityRailProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const hasWarning = entries.some((e) => e.icon === 'warning');

  return (
    <aside
      aria-label="Aktivite paneli"
      className={cn(
        'border-border bg-card duration-slow ease-out-quart flex h-full flex-col border-l transition-[width]',
        open ? 'w-rail-activity-open' : 'w-rail-activity',
      )}
    >
      <div className="p-3xs flex items-center justify-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? 'Aktivite panelini kapat' : 'Aktivite panelini aç'}
          aria-expanded={open}
          className="relative"
        >
          {open ? (
            <SidebarRightIcon className="size-icon-sm" />
          ) : (
            <Notification03Icon className="size-icon-sm" />
          )}
          {!open && hasWarning ? (
            <span className="right-3xs top-3xs bg-warning absolute size-2 rounded-full" />
          ) : null}
        </Button>
      </div>

      <Separator />

      {open ? (
        <ScrollArea className="flex-1">
          <ul className="gap-xs p-sm flex flex-col">
            {entries.map((entry) => {
              const Icon = ENTRY_ICON[entry.icon];
              return (
                <li
                  key={entry.id}
                  className="gap-xs p-xs hover:border-border hover:bg-muted/50 flex items-start rounded-md border border-transparent text-sm"
                >
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
      ) : (
        <ul className="gap-sm py-sm flex flex-col items-center">
          {entries.slice(0, 3).map((entry) => {
            const Icon = ENTRY_ICON[entry.icon];
            return (
              <li key={entry.id} aria-label={entry.title}>
                <Icon className={cn('size-icon-sm', ENTRY_TONE[entry.icon])} />
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
