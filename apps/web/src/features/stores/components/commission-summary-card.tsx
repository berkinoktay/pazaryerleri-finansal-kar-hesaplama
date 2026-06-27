'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

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
      <Card>
        <CardContent className="gap-md flex flex-col">
          <span className="text-foreground pt-2xs text-sm font-semibold">{t('title')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('infoBody')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-2xs flex flex-col">
          <span className="text-foreground text-sm font-semibold">{t('tipTitle')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
        </CardContent>
      </Card>
    </>
  );
}
