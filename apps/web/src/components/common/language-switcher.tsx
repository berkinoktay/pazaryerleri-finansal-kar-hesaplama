'use client';

import { Globe02Icon, Tick02Icon } from 'hugeicons-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALES, type Locale } from '@/i18n/config';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface LanguageSwitcherProps {
  /** Compact mode renders only the globe icon + code (for landing nav). */
  variant?: 'full' | 'compact';
  className?: string;
}

/**
 * Locale selector that preserves the current pathname and query string.
 * Selected locale is propagated via next-intl's router, which updates the
 * URL and sets the NEXT_LOCALE cookie for persistence across sessions.
 */
export function LanguageSwitcher({
  variant = 'full',
  className,
}: LanguageSwitcherProps): React.ReactElement {
  const t = useTranslations('languageSwitcher');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const queryString = searchParams.toString();
  const href = queryString ? `${pathname}?${queryString}` : pathname;

  const handleSelect = (next: Locale): void => {
    if (next === locale) return;
    startTransition(() => {
      router.replace(href, { locale: next });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === 'full' ? 'ghost' : 'outline'}
          size="sm"
          className={cn(
            variant === 'full' ? 'justify-start' : 'gap-xs',
            isPending && 'opacity-60',
            className,
          )}
          aria-label={t('label')}
        >
          <Globe02Icon className="size-icon-sm" />
          <span className="uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((option) => {
          const isActive = option === locale;
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => handleSelect(option)}
              className="justify-between"
            >
              <span>{t(option)}</span>
              {isActive ? (
                <Tick02Icon className="size-icon-sm text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
