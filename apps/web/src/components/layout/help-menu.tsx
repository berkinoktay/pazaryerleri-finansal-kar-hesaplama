'use client';

import { ArrowDown01Icon, HelpCircleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { HelpMenuItem } from '@/components/layout/nav-config';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface HelpMenuProps {
  items: readonly HelpMenuItem[];
}

/**
 * "Yardım & Destek" footer menu — a labelled sidebar row that opens a Popover
 * listing low-frequency help destinations (Yenilikler, Destek, …). Replaces
 * the former icon-only / separate-link footer shelf so the entries are
 * legible at a glance (the owner's concern) and the menu scales as docs /
 * shortcuts are added later. Mirrors UserMenu's trigger+popover shape so the
 * three footer rows (Bildirimler · Yardım & Destek · user) read as one family.
 *
 * @useWhen consolidating low-frequency help/support destinations into a single labelled sidebar-footer menu
 */
export function HelpMenu({ items }: HelpMenuProps): React.ReactElement {
  const t = useTranslations();
  const hasNew = items.some((item) => item.hasNewDot);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          tooltip={t('nav.help.label')}
          aria-label={t('nav.help.label')}
          className={cn(
            '[&>svg]:size-icon-lg! h-9',
            'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1.5!',
            'group-data-[collapsible=icon]:justify-center',
            'group-data-[collapsible=icon]:[&>span]:hidden',
          )}
        >
          <HelpCircleIcon />
          <span className="flex-1 text-left">{t('nav.help.label')}</span>
          {hasNew ? (
            <span
              aria-hidden
              className="bg-primary ml-auto size-1.5 shrink-0 rounded-full group-data-[collapsible=icon]:hidden"
            />
          ) : null}
          <ArrowDown01Icon
            className="size-icon-xs text-muted-foreground shrink-0 -rotate-90 group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="gap-3xs p-2xs flex w-48 flex-col"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                'gap-xs px-xs py-2xs duration-fast flex items-center rounded-sm text-sm transition-colors',
                'hover:bg-muted text-foreground',
                'focus-visible:outline-none',
              )}
            >
              <Icon className="size-icon-sm text-muted-foreground" />
              <span className="flex-1">{t(item.labelKey)}</span>
              {item.hasNewDot ? (
                <span aria-hidden className="bg-primary size-1.5 shrink-0 rounded-full" />
              ) : null}
            </Link>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
