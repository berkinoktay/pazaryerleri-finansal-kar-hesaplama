'use client';

import { useTranslations } from 'next-intl';

import { useStores } from '../hooks/use-stores';

import { StoresEmptyState } from './stores-empty-state';

export interface StoresPanelProps {
  orgId: string;
}

/**
 * Client-side dashboard panel. Fetches stores for the active org and
 * either renders the empty-state CTA (when zero stores exist) or a
 * compact list of connected stores. Lives inside the dashboard so
 * returning users with zero stores always see a path to connect.
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
    <div className="gap-xs flex flex-col">
      {stores.map((s) => (
        <div
          key={s.id}
          className="border-border bg-card p-md flex items-center justify-between rounded-md border"
        >
          <div className="gap-3xs flex flex-col">
            <span className="text-foreground font-medium">{s.name}</span>
            <span className="text-muted-foreground text-xs">
              {t(`platforms.${s.platform}`)} · {s.externalAccountId}
            </span>
          </div>
          <span className="text-muted-foreground text-xs">{s.environment}</span>
        </div>
      ))}
    </div>
  );
}
