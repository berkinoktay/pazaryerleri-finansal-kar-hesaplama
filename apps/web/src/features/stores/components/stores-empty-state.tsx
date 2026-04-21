'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

import { ConnectStoreModal } from './connect-store-modal';

export interface StoresEmptyStateProps {
  orgId: string;
}

export function StoresEmptyState({ orgId }: StoresEmptyStateProps): React.ReactElement {
  const t = useTranslations('stores');
  const tConnect = useTranslations('stores.connect');
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmptyState
        title={t('connect.title')}
        description={t('connect.subtitle')}
        action={<Button onClick={() => setOpen(true)}>{tConnect('actions.submit')}</Button>}
      />
      <ConnectStoreModal orgId={orgId} open={open} onOpenChange={setOpen} />
    </>
  );
}
