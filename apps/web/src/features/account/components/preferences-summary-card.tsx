'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Contextual aside for the Tercihler page — a short scope explanation and
 * a usage tip. Display-only: no actions, no mutations.
 */
export function PreferencesSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.preferences.summary');

  return (
    <>
      <Card>
        <CardContent className="gap-2xs flex flex-col">
          <span className="text-foreground text-sm font-semibold">{t('scopeTitle')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('scopeBody')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-2xs flex flex-col">
          <span className="text-foreground text-sm font-semibold">{t('tipTitle')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
        </CardContent>
      </Card>
    </>
  );
}
