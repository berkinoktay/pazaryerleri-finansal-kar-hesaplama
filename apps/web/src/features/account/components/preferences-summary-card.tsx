'use client';

import { useTranslations } from 'next-intl';

import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

/**
 * Contextual aside for the Tercihler page — a short scope explanation and
 * a usage tip. Display-only: no actions, no mutations.
 */
export function PreferencesSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.preferences.summary');

  return (
    <>
      <SettingsAsideCard title={t('scopeTitle')} icon={<DOMAIN_ICONS.theme />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('scopeBody')}</p>
      </SettingsAsideCard>

      <SettingsAsideCard title={t('tipTitle')} icon={<DOMAIN_ICONS.hint />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
      </SettingsAsideCard>
    </>
  );
}
