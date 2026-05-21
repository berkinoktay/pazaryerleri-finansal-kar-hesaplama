'use client';

import { RefreshIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { CopyableValue } from '@/components/patterns/copyable-value';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';

import { useRotateWebhookSecret } from '../hooks/use-rotate-webhook-secret';
import { useStores } from '../hooks/use-stores';

export interface WebhookSectionProps {
  orgId: string;
  storeId: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
}

/**
 * Webhook subscription is a TRENDYOL-only feature in V1. Hepsiburada
 * has no equivalent push channel today; render nothing for it so the
 * settings surface doesn't show a section the user can't act on.
 */
const WEBHOOK_SUPPORTED_PLATFORMS = new Set<WebhookSectionProps['platform']>(['TRENDYOL']);

/**
 * V1.1 closure for the Trendyol order-sync epic. Surfaces the per-store
 * webhook connection state (`webhookActiveAt`) and exposes a manual
 * rotate-secret action for OWNER/ADMIN seats. The action is gated
 * server-side too — the UI hides it for non-Trendyol stores as a UX
 * guard, not a permission check.
 */
export function WebhookSection({
  orgId,
  storeId,
  platform,
}: WebhookSectionProps): React.ReactElement | null {
  const t = useTranslations('stores.webhook');
  const { data: stores } = useStores(orgId);
  const rotate = useRotateWebhookSecret(orgId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (!WEBHOOK_SUPPORTED_PLATFORMS.has(platform)) return null;

  const store = stores?.find((s) => s.id === storeId);
  const isActive = store?.webhookActiveAt != null;

  const apiBaseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? '';
  const webhookUrl = `${apiBaseUrl}/v1/webhooks/orders/${storeId}`;

  const handleConfirm = async (): Promise<void> => {
    await rotate.mutateAsync(storeId);
    toast.success(t('rotate.success'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="gap-md flex flex-col">
        <div className="gap-2xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
            {t('status.label')}
          </span>
          <div className="gap-x-xs gap-y-3xs flex flex-wrap items-center text-sm">
            <span className="gap-2xs inline-flex items-center">
              <StatusDot
                tone={isActive ? 'success' : 'warning'}
                label={isActive ? t('status.active') : t('status.inactive')}
              />
              <span className={isActive ? 'text-foreground' : 'text-warning'}>
                {isActive ? t('status.active') : t('status.inactive')}
              </span>
            </span>
            {isActive && store?.webhookActiveAt != null ? (
              <span className="text-muted-foreground gap-2xs inline-flex items-center">
                <span aria-hidden>·</span>
                <span>{t('activatedAtLabel')}</span>
                <TimeAgo value={store.webhookActiveAt} />
              </span>
            ) : null}
          </div>
        </div>

        <div className={`gap-2xs flex flex-col ${isActive ? '' : 'opacity-60'}`}>
          <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
            {t('url.label')}
          </span>
          <CopyableValue value={webhookUrl} label={t('url.label')} className="max-w-full">
            <code className="text-foreground font-mono text-xs break-all">{webhookUrl}</code>
          </CopyableValue>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          trigger={
            <Button variant="outline" size="sm" className="gap-xs pointer-coarse:h-11">
              <RefreshIcon className="size-icon-xs" />
              {t('rotate.action')}
            </Button>
          }
          title={t('rotate.confirmTitle')}
          description={t('rotate.confirmDescription')}
          confirmLabel={t('rotate.confirmAction')}
          tone="destructive"
          onConfirm={handleConfirm}
          loading={rotate.isPending}
        />
      </CardFooter>
    </Card>
  );
}
