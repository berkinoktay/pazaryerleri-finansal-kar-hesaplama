'use client';

import { useTranslations } from 'next-intl';

import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

/**
 * Contextual aside for the Komisyon (Commission) settings page.
 *
 * Two cards:
 *  1. An information card explaining that commission rates come from the
 *     marketplace and vary by seller level — no user input needed.
 *  2. A tip nudging the user to verify current rates in the marketplace
 *     seller panel and noting that settlement reconciliation reflects
 *     real rates automatically.
 *
 * Display-only: no mutations, no actions.
 */
export function CommissionSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.commission.summary');

  return (
    <>
      <SettingsAsideCard title={t('title')} icon={<DOMAIN_ICONS.sellerLevel />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('infoBody')}</p>
      </SettingsAsideCard>

      <SettingsAsideCard title={t('tipTitle')} icon={<DOMAIN_ICONS.hint />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
      </SettingsAsideCard>
    </>
  );
}
