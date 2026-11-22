'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { useProfitBlockerReasons } from '../hooks/use-profit-blocker-reasons';
import { type ProfitBlocker } from '../lib/profit-blocker-message';

import { ProfitBlockerReasonList } from './profit-blocker-reason-list';

export interface ProfitBlockersAlertProps {
  /** The API's `profitBlockers`; empty for every order whose profit is computable. */
  blockers: readonly ProfitBlocker[];
}

/**
 * Order-detail warning for a profit the API reports as not computable: a title and
 * one line per reason, above the profit section. Renders nothing without blockers.
 * The orders-list sheet and the live-performance sheet both render the order detail,
 * so the same alert reaches the seller from every surface.
 */
export function ProfitBlockersAlert({
  blockers,
}: ProfitBlockersAlertProps): React.ReactElement | null {
  const t = useTranslations('profitBlockers');
  const reasons = useProfitBlockerReasons(blockers);

  if (blockers.length === 0) {
    return null;
  }

  return (
    <Alert tone="warning" size="md">
      <AlertTitle>{t('title')}</AlertTitle>
      {reasons.length > 0 ? (
        <AlertDescription>
          <ProfitBlockerReasonList reasons={reasons} />
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
