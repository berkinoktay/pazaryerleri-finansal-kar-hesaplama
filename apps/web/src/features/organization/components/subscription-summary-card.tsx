'use client';

import { useTranslations } from 'next-intl';

import { Progress } from '@/components/ui/progress';
import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { useCurrentScope } from '@/providers/current-scope';

/**
 * Contextual aside for the Abonelik page. Displays a compact quota summary
 * (mağaza and sipariş usage bars) alongside a short plan tip. All values are
 * representative placeholder figures — no billing backend exists yet.
 * Display-only: no actions, no mutations.
 */
export function SubscriptionSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.subscription.summary');
  const { accessibleStores } = useCurrentScope();

  // Placeholder quota values — will be replaced once the billing backend lands.
  const storeUsed = accessibleStores.length;
  const storeLimit = 3;
  const orderUsed = 248;
  const orderLimit = 500;

  const storePercent = Math.min(Math.round((storeUsed / storeLimit) * 100), 100);
  const orderPercent = Math.min(Math.round((orderUsed / orderLimit) * 100), 100);

  const quotaRows = [
    {
      key: 'stores',
      label: t('stores'),
      used: storeUsed,
      limit: storeLimit,
      percent: storePercent,
    },
    {
      key: 'orders',
      label: t('orders'),
      used: orderUsed,
      limit: orderLimit,
      percent: orderPercent,
    },
  ] as const;

  return (
    <>
      <SettingsAsideCard title={t('usageTitle')} icon={<DOMAIN_ICONS.usage />}>
        <dl className="gap-md flex flex-col">
          {quotaRows.map((row) => (
            <div key={row.key} className="gap-xs flex flex-col">
              <div className="flex items-center justify-between text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-foreground font-medium tabular-nums">
                  {row.used}
                  <span className="text-muted-foreground font-normal">/{row.limit}</span>
                </dd>
              </div>
              <Progress
                value={row.percent}
                size="sm"
                tone={row.percent >= 90 ? 'warning' : 'primary'}
                aria-label={row.label}
              />
            </div>
          ))}
        </dl>
      </SettingsAsideCard>

      <SettingsAsideCard title={t('tipTitle')} icon={<DOMAIN_ICONS.info />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
      </SettingsAsideCard>
    </>
  );
}
