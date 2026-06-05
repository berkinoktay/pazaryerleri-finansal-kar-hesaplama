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
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { IdentityCell } from '@/components/patterns/identity-cell';
import { LocaleFlag } from '@/components/common/locale-flag';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { SidebarMenuButton, useSidebar } from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useSignOut } from '@/features/auth/hooks/use-sign-out';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import { useLocaleSwitch } from '@/lib/use-locale-switch';
import { useOrderSoundPref } from '@/lib/use-order-sound-pref';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

type ThemeIcon = typeof Sun03Icon;

const THEME_OPTIONS = [
  { value: 'light', icon: Sun03Icon, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon02Icon, labelKey: 'theme.dark' },
  { value: 'system', icon: ComputerIcon, labelKey: 'theme.system' },
] as const;

// String-keyed so the (string | undefined) theme from next-themes indexes
// safely without an assertion; falls back to the System icon.
const THEME_ICON: Record<string, ThemeIcon> = {
  light: Sun03Icon,
  dark: Moon02Icon,
  system: ComputerIcon,
};

export interface UserMenuProps {
  /**
   * Where the trigger physically sits — drives correct popover placement so it
   * never relies on collision recovery. `footer` (default): the sidebar bottom
   * dock — opens UP (or to the right when the rail is collapsed). `header`: the
   * mobile top header — opens DOWN, right-aligned, from a top-right trigger.
   */
  placement?: 'footer' | 'header';
}

/**
 * Account / user-detail menu — a full-width identity row at the bottom of the
 * sidebar that opens an identity card.
 *
 * The card (Linear/Vercel/Mercury vocabulary) leads with the user identity
 * (avatar + name + email), then account navigation (Profil / Hesap ayarları),
 * a single compact appearance row (theme as a dropdown + language as
 * country-flag toggle — quiet inline controls, not a settings panel), and a
 * destructive sign-out. Icons sit bare (no tinted tiles) for a minimal read;
 * every interactive row carries a visible focus ring and a pointer cursor.
 *
 * In sidebar-collapsed (icon-only) mode the trigger collapses to just the
 * avatar; SidebarMenuButton's built-in tooltip surfaces the name on hover.
 *
 * @useWhen mounting the account/identity menu in the sidebar footer (identity, account links, theme dropdown + language flags, sign-out)
 */
export function UserMenu({ placement = 'footer' }: UserMenuProps = {}): React.ReactElement {
  const t = useTranslations('userMenu');
  const tAuth = useTranslations('auth.userMenu');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  const { theme, setTheme } = useTheme();
  const { locale, isPending, switchTo } = useLocaleSwitch();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  // Placement: the mobile header trigger sits top-right → open DOWN + right-
  // aligned (extends left). The sidebar footer opens UP (expanded) or to the
  // right of the rail (collapsed). Explicit per-context so neither leans on
  // Radix collision recovery to land in a sane spot.
  const isHeader = placement === 'header';
  const popoverSide = isHeader ? 'bottom' : collapsed ? 'right' : 'top';
  const popoverAlign = isHeader ? 'end' : collapsed ? 'end' : 'start';

  const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useOrderSoundPref();
  const soundLabelId = React.useId();
  const langLabelId = React.useId();

  const initials = deriveInitials(user?.email ?? '?');
  const metadataFullName = user?.user_metadata?.full_name;
  const fullName = typeof metadataFullName === 'string' ? metadataFullName : undefined;
  const displayName = fullName ?? user?.email?.split('@')[0] ?? '';
  const triggerLabel = fullName ?? user?.email ?? t('open');

  // Safe inside the popover: the content only mounts on click (no SSR), so
  // reading `theme` to pick the trigger icon can't cause a hydration mismatch.
  const activeThemeValue = theme ?? 'system';
  const ActiveThemeIcon = THEME_ICON[activeThemeValue] ?? ComputerIcon;
  const activeThemeLabel = t(
    THEME_OPTIONS.find((option) => option.value === activeThemeValue)?.labelKey ?? 'theme.system',
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          className={cn(
            'data-[state=open]:bg-muted h-12',
            // Collapsed: match the 40px nav-button size so the avatar sits
            // aligned with every other icon in the rail. p-1! overrides the
            // primitive's forced p-2! to leave a 32px content area that fits a
            // size-sm (32px) avatar exactly.
            'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1!',
          )}
          tooltip={triggerLabel}
        >
          <Avatar size="sm" className="rounded-md">
            <AvatarFallback className="rounded-md">{initials}</AvatarFallback>
          </Avatar>
          <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-foreground truncate text-left text-xs font-medium">
              {displayName}
            </span>
            {user?.email ? (
              <span className="text-muted-foreground text-2xs truncate text-left">
                {user.email}
              </span>
            ) : null}
          </span>
          <ArrowDown01Icon
            className="size-icon-xs text-muted-foreground shrink-0 -rotate-90 group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        // Expanded footer: open up, left-aligned so the panel extends RIGHT over
        // the content area instead of off the sidebar's left edge. Collapsed
        // rail: open right, bottom-aligned so it extends UP. Mobile header: open
        // down, right-aligned. (See popoverSide/popoverAlign above.)
        side={popoverSide}
        align={popoverAlign}
        sideOffset={8}
        className="w-72 p-0"
      >
        {/* Identity header — avatar + name + email. */}
        <div className="p-sm">
          <IdentityCell
            size="md"
            leading={
              <Avatar size="md" className="rounded-md">
                <AvatarFallback className="rounded-md">{initials}</AvatarFallback>
              </Avatar>
            }
            title={displayName}
            meta={<span className="truncate">{user?.email ?? ''}</span>}
          />
        </div>

        <Separator variant="muted" />

        <nav className="gap-3xs p-2xs flex flex-col" aria-label={t('open')}>
          <MenuRow href="/settings/profile" icon={UserIcon} label={t('profile')} />
          <MenuRow href="/settings" icon={Settings02Icon} label={t('settings')} />
        </nav>

        <Separator variant="muted" />

        {/* Appearance — a single compact row: theme dropdown + language flags.
            Quiet inline controls, not a settings panel. */}
        <div className="gap-sm px-sm py-xs flex items-center justify-between">
          <div className="gap-xs flex items-center">
            <span className="text-2xs text-muted-foreground font-medium">{t('theme.heading')}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2xs px-2xs"
                  // Carry the CURRENT theme in the accessible name (e.g. "Tema: Koyu")
                  // — the swapped icon alone is value-less to screen readers.
                  aria-label={`${t('theme.heading')}: ${activeThemeLabel}`}
                >
                  <ActiveThemeIcon className="size-icon-xs" aria-hidden />
                  <ArrowDown01Icon className="size-icon-xs text-muted-foreground" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="min-w-36">
                <DropdownMenuRadioGroup
                  value={theme ?? 'system'}
                  onValueChange={(value) => setTheme(value)}
                >
                  {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
                    <DropdownMenuRadioItem key={value} value={value} className="gap-xs">
                      <Icon className="size-icon-sm text-muted-foreground" />
                      {t(labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="gap-xs flex items-center">
            <span id={langLabelId} className="text-2xs text-muted-foreground font-medium">
              {t('language.heading')}
            </span>
            <ToggleGroup
              type="single"
              value={locale}
              onValueChange={(value) => {
                const next = LOCALES.find((option) => option === value);
                if (next) switchTo(next);
              }}
              size="sm"
              aria-labelledby={langLabelId}
              // Mirror the visual pending dim with an assistive-tech equivalent.
              aria-busy={isPending || undefined}
              className={cn(isPending && 'opacity-60')}
            >
              {LOCALES.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={option}
                  aria-label={LOCALE_LABELS[option]}
                  className="px-2xs cursor-pointer"
                >
                  <LocaleFlag locale={option} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        <div className="gap-sm px-sm py-xs flex items-center justify-between">
          <span id={soundLabelId} className="text-2xs text-muted-foreground font-medium">
            {t('sound.heading')}
          </span>
          <Switch
            size="sm"
            checked={soundEnabled}
            onCheckedChange={setSoundEnabled}
            aria-labelledby={soundLabelId}
          />
        </div>

        <Separator variant="muted" />

        <div className="p-2xs">
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className={cn(
              'gap-xs px-2xs py-2xs duration-fast flex w-full cursor-pointer items-center rounded-sm text-sm transition-colors',
              'text-destructive hover:bg-destructive-surface',
              'focus-visible:ring-destructive focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <Logout01Icon className="size-icon-sm" />
            <span className="flex-1 text-left">{tAuth('signOut')}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuRow({
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
        'gap-xs px-2xs py-2xs duration-fast flex cursor-pointer items-center rounded-sm text-sm transition-colors',
        'text-foreground hover:bg-muted',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
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
