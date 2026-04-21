'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { useStores } from '../hooks/use-stores';

import { StoresEmptyState } from './stores-empty-state';

export interface StoresPanelProps {
  orgId: string;
}

/**
 * Client-side dashboard panel. Fetches stores for the active org and
 * either renders the empty-state CTA (when zero stores exist) or a
 * compact list of connected stores. The connect-store entry point for
 * users with ≥1 store lives in the sidebar's ContextRail "+ Mağaza
 * bağla" button — no duplicate CTA on the panel.
 */
export function StoresPanel({ orgId }: StoresPanelProps): React.ReactElement {
  const t = useTranslations('stores');
  const tCommon = useTranslations('common');
  const { data: stores, isPending, isError } = useStores(orgId);

  if (isPending) {
    return <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>;
  }
  if (isError) {
    return <p className="text-destructive text-sm">{tCommon('errors.generic')}</p>;
  }
  if (stores.length === 0) {
    return <StoresEmptyState orgId={orgId} />;
  }
  return (
    <div className="gap-sm flex flex-col">
      <h2 className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
        {t('panel.title')}
      </h2>
      <div className="gap-xs flex flex-col">
        {stores.map((s) => (
          <Card key={s.id} className="p-md flex flex-row items-center justify-between">
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{s.name}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t(`platforms.${s.platform}`)} · {s.externalAccountId}
              </span>
            </div>
            {s.environment === 'SANDBOX' ? (
              <Badge className="text-2xs tracking-wide uppercase">
                {t('environments.SANDBOX')}
              </Badge>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
