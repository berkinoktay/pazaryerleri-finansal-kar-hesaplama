import { APP_TIME_ZONE } from '@pazarsync/utils';

export const LOCALES = ['tr', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'tr';

// Display timezone for all UI date/number formatting — sourced from the single
// app-wide business timezone so frontend formatting and backend business-day
// logic can never drift. See packages/utils/src/timezone.ts.
export const TIME_ZONE = APP_TIME_ZONE;

export const LOCALE_LABELS: Record<Locale, string> = {
  tr: 'Türkçe',
  en: 'English',
};
