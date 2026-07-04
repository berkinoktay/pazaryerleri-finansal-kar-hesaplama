'use client';

import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import type { CommissionSourceMode } from '../types';

const COMMISSION_TARIFFS_PATH = '/campaigns/product-commission-tariffs';

export interface AdvantageCommissionWarningProps {
  /** pinned / category. */
  commissionSourceMode: CommissionSourceMode;
  /** True when a H="Var" product failed to match an active commission tariff. */
  hasUnmatchedCommissionProducts: boolean;
}

/**
 * The "smart hybrid" (C) missing-commission UX: when the tier profits fall back to the
 * category commission (`commissionSourceMode === 'category'`) BUT the file has products
 * that declare a commission tariff (`hasUnmatchedCommissionProducts`), the category rate
 * may not reflect the real reduced rate. This non-blocking banner nudges the seller to
 * upload this period's Commission Excel (with a CTA to that vertical), while letting them
 * dismiss and continue with the category rate. Dismiss is local-only (no API) — it just
 * hides the banner for this session. Uses the design-system warning tone
 * (bg-warning-surface + text-warning), never a left-border accent. If ALL products are
 * H="Yok" the category rate is correct, so nothing renders.
 */
export function AdvantageCommissionWarning({
  commissionSourceMode,
  hasUnmatchedCommissionProducts,
}: AdvantageCommissionWarningProps): React.ReactElement | null {
  const t = useTranslations('productLabelsPage.commissionWarning');
  const [dismissed, setDismissed] = React.useState(false);

  if (commissionSourceMode !== 'category' || !hasUnmatchedCommissionProducts || dismissed) {
    return null;
  }

  return (
    <div className="bg-warning-surface gap-sm p-md flex flex-wrap items-start rounded-lg">
      <Alert02Icon className="text-warning size-icon-sm mt-3xs shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-warning text-sm font-semibold">{t('title')}</p>
        <p className="text-warning text-2xs mt-3xs">{t('description')}</p>
        <div className="gap-sm mt-sm flex flex-wrap items-center">
          <Button asChild size="sm" variant="outline">
            <Link href={COMMISSION_TARIFFS_PATH}>{t('cta')}</Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
