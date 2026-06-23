// design-sync preview provider — wraps every preview card so next-intl hooks
// (useTranslations / useFormatter) resolve against the product's real Turkish
// messages and format presets. Referenced by cfg.provider.component in
// .design-sync/config.json and re-exported from pilot-entry.tsx onto the bundle.
import * as React from 'react';
import { NextIntlClientProvider } from 'next-intl';

import { FORMATS } from '../src/i18n/formats';

import messages from '../messages/tr.json';

export function PreviewProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <NextIntlClientProvider
      locale="tr"
      timeZone="Europe/Istanbul"
      now={new Date('2026-06-23T09:00:00.000Z')}
      messages={messages}
      formats={FORMATS}
    >
      {children}
    </NextIntlClientProvider>
  );
}
