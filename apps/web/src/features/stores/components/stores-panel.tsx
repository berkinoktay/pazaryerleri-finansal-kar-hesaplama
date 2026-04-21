'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { useStores } from '../hooks/use-stores';

import { ConnectStoreModal } from './connect-store-modal';
import { StoresEmptyState } from './stores-empty-state';

export interface StoresPanelProps {
  orgId: string;
}

/**
 * Client-side dashboard panel. Fetches stores for the active org and
 * either renders the empty-state CTA (when zero stores exist) or a
 * compact list of connected stores with an "Add another" button.
 * Lives inside the dashboard so returning users with zero stores always
 * see a path to connect, and users with 1+ stores can always add more.
 */
export function StoresPanel({ orgId }: StoresPanelProps): React.ReactElement {
  const t = useTranslations('stores');
  const tCommon = useTranslations('common');
  const tConnect = useTranslations('stores.connect');
  const [modalOpen, setModalOpen] = useState(false);
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
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-md font-semibold">{t('connect.title')}</h2>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          + {tConnect('actions.submit')}
        </Button>
      </div>
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
      <ConnectStoreModal orgId={orgId} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
