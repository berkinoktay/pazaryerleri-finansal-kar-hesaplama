'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { MarketplaceLogo, type MarketplacePlatform } from '@/components/patterns/marketplace-logo';
import { Button } from '@/components/ui/button';

import { ConnectStoreModal } from './connect-store-modal';

export interface StoresEmptyStateProps {
  orgId: string;
}

const SUPPORTED_PLATFORMS: readonly MarketplacePlatform[] = ['TRENDYOL', 'HEPSIBURADA'];

export function StoresEmptyState({ orgId }: StoresEmptyStateProps): React.ReactElement {
  const t = useTranslations('stores');
  const tConnect = useTranslations('stores.connect');
  const tPlatforms = useTranslations('stores.platforms');
  const tStatus = useTranslations('stores.platformStatus');
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmptyState
        title={t('connect.title')}
        description={t('connect.subtitle')}
        action={<Button onClick={() => setOpen(true)}>{tConnect('actions.submit')}</Button>}
        footer={
          <div className="gap-sm border-border flex flex-wrap items-center justify-center border-t pt-4">
            <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
              {t('panel.integrations')}
            </span>
            {SUPPORTED_PLATFORMS.map((platform, idx) => {
              const disabled = idx > 0;
              return (
                <div
                  key={platform}
                  className={
                    disabled
                      ? 'gap-2xs border-border px-sm py-3xs flex items-center rounded-full border opacity-60'
                      : 'gap-2xs bg-background border-border px-sm py-3xs flex items-center rounded-full border'
                  }
                >
                  <MarketplaceLogo platform={platform} size="md" alt={tPlatforms(platform)} />
                  {disabled ? (
                    <span className="text-muted-foreground text-2xs">{tStatus('comingSoon')}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        }
      />
      <ConnectStoreModal orgId={orgId} open={open} onOpenChange={setOpen} />
    </>
  );
}
