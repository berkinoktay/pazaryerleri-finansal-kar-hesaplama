'use client';

import { Layers01Icon, PercentCircleIcon, StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export type CommissionRatesEmptyVariant = 'no-store' | 'no-rates' | 'no-matches';

interface CommissionRatesEmptyStateProps {
  variant: CommissionRatesEmptyVariant;
  /** Fired when the user clicks "Filtreyi temizle" on the no-matches variant. */
  onClearFilters?: () => void;
}

export function CommissionRatesEmptyState({
  variant,
  onClearFilters,
}: CommissionRatesEmptyStateProps): React.ReactElement {
  const t = useTranslations('features.commissionRates.empty');

  if (variant === 'no-store') {
    return (
      <EmptyState
        icon={StoreLocation01Icon}
        title={t('noStore.title')}
        description={t('noStore.description')}
        action={
          <Button asChild>
            <Link href="/settings/stores">{t('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }

  if (variant === 'no-rates') {
    return (
      <EmptyState
        icon={PercentCircleIcon}
        title={t('noRates.title')}
        description={t('noRates.description')}
        className="border-0"
      />
    );
  }

  return (
    <EmptyState
      icon={Layers01Icon}
      title={t('noMatches.title')}
      description={t('noMatches.description')}
      action={
        onClearFilters !== undefined ? (
          <Button variant="outline" onClick={onClearFilters}>
            {t('noMatches.action')}
          </Button>
        ) : undefined
      }
      className="border-0"
    />
  );
}
