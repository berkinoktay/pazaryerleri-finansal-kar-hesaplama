'use client';

import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/config';
import { usePathname, useRouter } from '@/i18n/navigation';

/** Type guard — narrows next-intl's `string` locale to the app's `Locale` union without an assertion. */
function isLocale(value: string): value is Locale {
  return LOCALES.some((candidate) => candidate === value);
}

export interface LocaleSwitch {
  /** The active locale, narrowed to the app union (falls back to DEFAULT_LOCALE if somehow off-list). */
  locale: Locale;
  /** True while the locale navigation transition is in flight — dim the control. */
  isPending: boolean;
  /** Switch to `next`, preserving the current pathname + query string. No-op if already active. */
  switchTo: (next: Locale) => void;
}

/**
 * Shared locale-switch behavior: read the active locale and switch to a new
 * one while PRESERVING the current pathname + query string (next-intl's
 * router also sets the NEXT_LOCALE cookie). The switch runs inside a
 * transition so callers can dim their control while pending.
 *
 * Extracted when the account user-menu needed the same flow the
 * LanguageSwitcher already had — one source of truth so the two never drift
 * (the menu's former inline copy had silently dropped the pending affordance
 * and used an `as Locale` assertion).
 */
export function useLocaleSwitch(): LocaleSwitch {
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const switchTo = React.useCallback(
    (next: Locale): void => {
      if (next === locale) return;
      const queryString = searchParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      startTransition(() => {
        router.replace(href, { locale: next });
      });
    },
    [locale, pathname, searchParams, router],
  );

  return { locale, isPending, switchTo };
}
