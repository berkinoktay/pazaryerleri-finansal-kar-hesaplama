'use client';

import { CheckmarkCircle02Icon, Clock01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

/**
 * The upload/export status of an Advantage tariff — the list's only status axis
 * (Advantage files carry no dates, so there is no period-validity badge). Exported
 * (saved & downloaded) reads as a quiet success check; not-yet-exported reads as a
 * muted "Bekliyor".
 */
export interface AdvantageTariffExportIndicatorProps {
  exported: boolean;
}

export function AdvantageTariffExportIndicator({
  exported,
}: AdvantageTariffExportIndicatorProps): React.ReactElement {
  const t = useTranslations('productLabelsPage.status');

  if (!exported) {
    return (
      <span className="text-muted-foreground gap-2xs text-2xs inline-flex items-center">
        <Clock01Icon className="size-icon-xs shrink-0" aria-hidden />
        {t('pending')}
      </span>
    );
  }
  return (
    <span className="text-success gap-2xs text-2xs inline-flex items-center font-medium">
      <CheckmarkCircle02Icon className="size-icon-xs shrink-0" aria-hidden />
      {t('exported')}
    </span>
  );
}
