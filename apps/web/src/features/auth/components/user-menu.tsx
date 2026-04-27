'use client';

import {
  ArrowDown01Icon,
  ComputerIcon,
  Logout01Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
  UserIcon,
} from 'hugeicons-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton, SidebarSeparator, useSidebar } from '@/components/ui/sidebar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useSignOut } from '@/features/auth/hooks/use-sign-out';
import { LOCALES, type Locale } from '@/i18n/config';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

/**
 * User menu — full-width row at the bottom of the sidebar.
 *
 * Pattern follows Linear/Vercel/Notion: a row that shows the user's
 * identity (avatar + name + email) and opens a Popover with profile,
 * preferences, and sign-out actions. Replaces the previous
 * avatar-only trigger which gave no signal that it was clickable.
 *
 * Inside the Popover (the dropdown content), the surface is a card
 * with three sections separated by `SidebarSeparator`:
 *   1. Identity header — avatar + full name + email.
 *   2. Account links — Profile + Account Settings (these are
 *      preference-level pages owned by the current user, not
 *      app-wide concerns; that's why they live here, not in the
 *      sidebar — Destek + Ayarlar is in the sidebar for that).
 *   3. Preferences — Theme + Language ToggleGroups (always visible
 *      as segmented controls, not nested submenus).
 *   4. Sign out — destructive-tinted action at the bottom.
 *
 * In sidebar-collapsed (icon-only) mode, the trigger collapses to
 * just the avatar; the SidebarMenuButton primitive handles the
 * tooltip on hover.
 */
export function UserMenu(): React.ReactElement {
  const t = useTranslations('userMenu');
  const tAuth = useTranslations('auth.userMenu');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  const { theme, setTheme } = useTheme();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const handleLocaleChange = (next: string): void => {
    if (next === locale || !LOCALES.includes(next as Locale)) return;
    const queryString = searchParams.toString();
    const href = queryString ? `${pathname}?${queryString}` : pathname;
    startTransition(() => {
      router.replace(href, { locale: next as Locale });
    });
  };

  const initials = deriveInitials(user?.email ?? '?');
  const metadataFullName = user?.user_metadata?.full_name;
  const fullName = typeof metadataFullName === 'string' ? metadataFullName : undefined;
  const displayName = fullName ?? user?.email?.split('@')[0] ?? '';
  const triggerLabel = fullName ?? user?.email ?? t('open');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          className={cn(
            'data-[state=open]:bg-muted h-12',
            // Collapsed: match the 40px nav-button size so the avatar
            // sits aligned with every other icon in the rail. p-1!
            // overrides the primitive's forced p-2! to leave a 32px
            // content area that fits a size-sm (32px) avatar exactly.
            'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1!',
          )}
          tooltip={triggerLabel}
        >
          <Avatar size="sm" className="rounded-md">
            <AvatarFallback className="text-2xs rounded-md font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-foreground truncate text-xs font-medium">{displayName}</span>
            {user?.email ? (
              <span className="text-muted-foreground text-2xs truncate">{user.email}</span>
            ) : null}
          </span>
          <ArrowDown01Icon
            className="size-icon-xs text-muted-foreground shrink-0 -rotate-90 group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'top'}
        align="end"
        sideOffset={8}
        className="w-72 p-0"
      >
        <div className="gap-xs p-sm flex items-center">
          <Avatar size="md" className="rounded-md">
            <AvatarFallback className="rounded-md text-xs font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            {fullName ? (
              <span className="text-foreground truncate text-sm font-semibold">{fullName}</span>
            ) : null}
            <span className="text-muted-foreground text-2xs truncate">{user?.email ?? ''}</span>
          </div>
        </div>

        <SidebarSeparator className="mx-0" />

        <nav className="gap-3xs p-2xs flex flex-col" aria-label={t('open')}>
          <MenuLink href="/settings/profile" icon={UserIcon} label={t('profile')} />
          <MenuLink href="/settings" icon={Settings02Icon} label={t('settings')} />
        </nav>

        <SidebarSeparator className="mx-0" />

        <div className="gap-xs p-sm flex flex-col">
          <SegmentLabel>{t('theme.heading')}</SegmentLabel>
          <ToggleGroup
            type="single"
            value={theme ?? 'system'}
            onValueChange={(v) => v && setTheme(v as 'light' | 'dark' | 'system')}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <ToggleGroupItem value="light" aria-label={t('theme.light')} className="gap-3xs flex-1">
              <Sun03Icon className="size-icon-xs" /> {t('theme.light')}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label={t('theme.dark')} className="gap-3xs flex-1">
              <Moon02Icon className="size-icon-xs" /> {t('theme.dark')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="system"
              aria-label={t('theme.system')}
              className="gap-3xs flex-1"
            >
              <ComputerIcon className="size-icon-xs" /> {t('theme.system')}
            </ToggleGroupItem>
          </ToggleGroup>

          <SegmentLabel>{t('language.heading')}</SegmentLabel>
          <ToggleGroup
            type="single"
            value={locale}
            onValueChange={handleLocaleChange}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {LOCALES.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                aria-label={option.toUpperCase()}
                className="flex-1 uppercase"
              >
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <SidebarSeparator className="mx-0" />

        <div className="p-2xs">
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className={cn(
              'gap-xs px-xs py-2xs duration-fast flex w-full items-center rounded-sm text-xs transition-colors',
              'text-destructive hover:bg-destructive-surface',
              'focus-visible:outline-none disabled:opacity-60',
            )}
          >
            <Logout01Icon className="size-icon-sm" />
            {tAuth('signOut')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SegmentLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
      {children}
    </span>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'gap-xs px-xs py-2xs duration-fast flex items-center rounded-sm text-xs transition-colors',
        'hover:bg-muted text-foreground',
        'focus-visible:outline-none',
      )}
    >
      <Icon className="size-icon-sm text-muted-foreground" />
      <span className="flex-1">{label}</span>
    </Link>
  );
}

function deriveInitials(emailOrName: string): string {
  const base = emailOrName.split('@')[0] ?? '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
