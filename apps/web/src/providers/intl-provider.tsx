'use client';

import { NextIntlClientProvider } from 'next-intl';
import { DEFAULT_LOCALE, DEFAULT_MESSAGES, DEFAULT_TIME_ZONE } from '@/i18n/messages';

/**
 * Minimal intl provider scaffold.
 *
 * Full i18n strategy (request-side config, dynamic message loading, locale
 * routing) is deferred — tracked separately from the design system. For now
 * this wraps children so `useTranslations` / `useFormatter` calls don't crash
 * and the showcase can demonstrate how feature code should read keys.
 */
export function IntlProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={DEFAULT_MESSAGES}
      timeZone={DEFAULT_TIME_ZONE}
    >
      {children}
    </NextIntlClientProvider>
  );
}
