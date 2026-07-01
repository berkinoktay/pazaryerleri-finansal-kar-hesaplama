'use client';

import { CheckmarkCircle02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

/**
 * The "exported" axis of a tariff's status — separate from the period-validity
 * badge so the two signals stay legible. Exported (saved & downloaded) reads as
 * a quiet success check; not-yet-exported reads as muted "Bekliyor".
 */
export interface CommissionTariffExportIndicatorProps {
  exported: boolean;
}

export function CommissionTariffExportIndicator({
  exported,
}: CommissionTariffExportIndicatorProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.status');

  if (!exported) {
    return <span className="text-muted-foreground text-2xs">{t('pending')}</span>;
  }
  return (
    <span className="text-success gap-2xs text-2xs inline-flex items-center font-medium">
      <CheckmarkCircle02Icon className="size-icon-xs shrink-0" aria-hidden />
      {t('exported')}
    </span>
  );
}
