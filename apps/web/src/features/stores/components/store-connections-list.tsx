'use client';

import { Add01Icon, MoreVerticalIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type ToneKey } from '@/lib/variants';

import type { Store } from '../api/list-stores.api';
import { useDisconnectStore } from '../hooks/use-disconnect-store';
import { useStores } from '../hooks/use-stores';

import { ConnectStoreModal } from './connect-store-modal';
import { StoresEmptyState } from './stores-empty-state';

const STATUS: Record<Store['status'], { tone: ToneKey; key: 'active' | 'error' | 'disabled' }> = {
  ACTIVE: { tone: 'success', key: 'active' },
  CONNECTION_ERROR: { tone: 'destructive', key: 'error' },
  DISABLED: { tone: 'neutral', key: 'disabled' },
};

export interface StoreConnectionsListProps {
  orgId: string;
  initialStores: Store[];
}

/**
 * The connected-stores list (Mağaza > Bağlantılar). Lists every connected
 * marketplace store with its status and last sync, a "Mağaza bağla" action
 * (the wired connect modal), and a per-store menu: disconnect (wired, with a
 * destructive confirm) and credential rotation (draft). Reads/refreshes via
 * the same React Query cache the dashboard uses.
 */
export function StoreConnectionsList({
  orgId,
  initialStores,
}: StoreConnectionsListProps): React.ReactElement {
  const t = useTranslations('settings.connections');
  const tStores = useTranslations('stores');
  const tStatus = useTranslations('featureStatus');
  const format = useFormatter();

  const { data } = useStores(orgId, initialStores);
  const stores = data ?? initialStores;
  const disconnect = useDisconnectStore(orgId);

  const [connectOpen, setConnectOpen] = useState(false);
  const [target, setTarget] = useState<Store | null>(null);

  function confirmDisconnect(): void {
    if (target === null) return;
    disconnect.mutate(target.id, {
      onSuccess: () => {
        toast.success(t('disconnected'));
        setTarget(null);
      },
      onError: () => setTarget(null),
    });
  }

  if (stores.length === 0) {
    return (
      <>
        <StoresEmptyState orgId={orgId} />
        <ConnectStoreModal orgId={orgId} open={connectOpen} onOpenChange={setConnectOpen} />
      </>
    );
  }

  return (
    <>
      <Card>
        <div className="border-border gap-md p-lg flex items-center justify-between border-b">
          <h2 className="text-md font-semibold">{t('listTitle')}</h2>
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Add01Icon />
            {t('connect')}
          </Button>
        </div>
        <div className="divide-border flex flex-col divide-y">
          {stores.map((store) => {
            const status = STATUS[store.status];
            return (
              <div key={store.id} className="gap-md p-lg flex items-center">
                <MarketplaceLogo
                  platform={store.platform}
                  size="lg"
                  alt={tStores(`platforms.${store.platform}`)}
                />
                <div className="gap-3xs flex min-w-0 flex-1 flex-col">
                  <div className="gap-xs flex flex-wrap items-center">
                    <span className="text-foreground truncate text-sm font-medium">
                      {store.name}
                    </span>
                    <Badge tone={status.tone} size="sm">
                      {t(`status.${status.key}`)}
                    </Badge>
                    {store.environment === 'SANDBOX' ? (
                      <Badge size="sm" className="tracking-wide uppercase">
                        {tStores('environments.SANDBOX')}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-2xs text-muted-foreground tabular-nums">
                    #{store.externalAccountId} · {t('lastSync')}:{' '}
                    {store.lastSyncAt !== null
                      ? format.dateTime(new Date(store.lastSyncAt), 'short')
                      : t('neverSynced')}
                  </span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t('actions.menu')}>
                      <MoreVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => toast.info(tStatus('draftActionToast'))}>
                      {t('actions.rotate')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setTarget(store)}
                    >
                      {t('actions.disconnect')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </Card>

      <ConnectStoreModal orgId={orgId} open={connectOpen} onOpenChange={setConnectOpen} />

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disconnectConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('disconnectConfirm.body', { name: target?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('disconnectConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisconnect} disabled={disconnect.isPending}>
              {t('disconnectConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
