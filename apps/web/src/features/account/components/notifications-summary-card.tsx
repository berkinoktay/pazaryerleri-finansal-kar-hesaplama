'use client';

import { useTranslations } from 'next-intl';

import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

/**
 * Contextual aside for the Bildirimler page — explains how notifications work
 * and offers a short usage tip. Display-only: no actions, no mutations.
 */
export function NotificationsSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.notifications.summary');

  return (
    <>
      <SettingsAsideCard title={t('howTitle')} icon={<DOMAIN_ICONS.info />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('howBody')}</p>
      </SettingsAsideCard>

      <SettingsAsideCard title={t('tipTitle')} icon={<DOMAIN_ICONS.hint />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
      </SettingsAsideCard>
    </>
  );
}
