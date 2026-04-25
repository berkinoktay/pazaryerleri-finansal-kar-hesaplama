'use client';

import {
  ComputerIcon,
  HelpCircleIcon,
  KeyboardIcon,
  Logout01Icon,
  MessageMultiple02Icon,
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
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useSignOut } from '@/features/auth/hooks/use-sign-out';
import { LOCALES, type Locale } from '@/i18n/config';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

/**
 * User menu — avatar trigger anchored to the IconRail bottom slot.
 *
 * Built on Popover (not DropdownMenu) so it can host non-menuitem
 * widgets: segmented ToggleGroups for theme + language, in addition
 * to navigational links and the destructive sign-out action. Replaces
 * the old email-only dropdown that lived alongside a separate
 * ContextRail bottom slot.
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

  const handleLocaleChange = (next: string): void => {
    if (next === locale || !LOCALES.includes(next as Locale)) return;
    const queryString = searchParams.toString();
    const href = queryString ? `${pathname}?${queryString}` : pathname;
    startTransition(() => {
      router.replace(href, { locale: next as Locale });
    });
  };

  const initials = deriveInitials(user?.email ?? '?');
  // TODO(post-MVP): wire up user_metadata.full_name once sign-up captures it.
  const metadataFullName = user?.user_metadata?.full_name;
  const fullName = typeof metadataFullName === 'string' ? metadataFullName : undefined;

  return (
    <Popover>
      <PopoverTrigger
        className="flex size-9 items-center justify-center rounded-md focus-visible:outline-none"
        aria-label={t('open')}
      >
        <Avatar className="size-7">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-72 p-0">
        {user?.email !== undefined ? (
          <div className="gap-xs p-sm flex items-center">
            <Avatar className="size-9">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              {fullName ? (
                <span className="text-foreground truncate text-sm font-semibold">{fullName}</span>
              ) : null}
              <span className="text-muted-foreground truncate text-xs">{user.email}</span>
            </div>
          </div>
        ) : null}

        <Separator />

        <div className="gap-3xs p-2xs flex flex-col">
          <MenuLink href="/settings/profile" icon={UserIcon} label={t('profile')} />
          <MenuLink href="/settings" icon={Settings02Icon} label={t('settings')} />
        </div>

        <Separator />

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
              <Sun03Icon className="size-icon-sm" /> {t('theme.light')}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label={t('theme.dark')} className="gap-3xs flex-1">
              <Moon02Icon className="size-icon-sm" /> {t('theme.dark')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="system"
              aria-label={t('theme.system')}
              className="gap-3xs flex-1"
            >
              <ComputerIcon className="size-icon-sm" /> {t('theme.system')}
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

        <Separator />

        <div className="gap-3xs p-2xs flex flex-col">
          <MenuLink href="/help" icon={HelpCircleIcon} label={t('help.docs')} />
          <MenuLink
            href="/help/shortcuts"
            icon={KeyboardIcon}
            label={t('help.shortcuts')}
            kbd="⌘?"
          />
          <MenuLink href="/help/feedback" icon={MessageMultiple02Icon} label={t('help.feedback')} />
        </div>

        <Separator />

        <div className="p-2xs">
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className={cn(
              'gap-xs px-xs py-3xs duration-fast flex w-full items-center rounded-md text-sm transition-colors',
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
  kbd,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  kbd?: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'gap-xs px-xs py-3xs duration-fast flex items-center rounded-md text-sm transition-colors',
        'hover:bg-muted text-foreground',
        'focus-visible:outline-none',
      )}
    >
      <Icon className="size-icon-sm text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {kbd ? (
        <kbd className="text-2xs text-muted-foreground bg-muted px-3xs py-3xs rounded font-mono">
          {kbd}
        </kbd>
      ) : null}
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
