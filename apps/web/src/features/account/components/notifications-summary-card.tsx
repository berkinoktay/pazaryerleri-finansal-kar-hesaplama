'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Contextual aside for the Bildirimler page — explains how notifications work
 * and offers a short usage tip. Display-only: no actions, no mutations.
 */
export function NotificationsSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.notifications.summary');

  return (
    <>
      <Card>
        <CardContent className="gap-xs flex flex-col">
          <span className="text-foreground text-sm font-semibold">{t('howTitle')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('howBody')}</p>
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
