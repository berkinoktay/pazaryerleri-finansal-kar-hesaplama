'use client';

import { CheckmarkCircle02Icon, Clock01Icon } from 'hugeicons-react';
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
    // Icon pair with the exported state (neutral clock ↔ green check) so the
    // column reads as a STATUS at a glance, not a bare gray word.
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
