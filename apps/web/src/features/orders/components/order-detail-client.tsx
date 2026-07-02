'use client';

import { ArrowLeft01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { PageHeader } from '@/components/patterns/page-header';
import { ProfitBreakdownCard } from '@/components/patterns/profit-breakdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

import { useOrder } from '../hooks/use-order';

import { OrderClaimsCard } from './order-claims-card';
import { OrderDeliverySection } from './order-delivery-section';
import { OrderFeeTimeline } from './order-fee-timeline';
import { OrderItemsList } from './order-items-list';
import { OrderKpiGrid } from './order-kpi-grid';
import { OrderStatusBadge } from './order-status-badge';
import { OrderStatusBanner } from './order-status-banner';
import { ReconciliationStatusBadge } from './reconciliation-status-badge';

interface OrderDetailClientProps {
  orgId: string | null;
  storeId: string | null;
  orderId: string;
  /** 'page' (default) renders the full page chrome (back-nav + PageHeader).
   *  'modal' omits both - the host (Sheet) owns the header + close. */
  chrome?: 'page' | 'modal';
}

/**
 * Order detail composer. Loads the full order graph and stacks the layered
 * surfaces specified in the V1 design doc § 7.4:
 *   1. Header — order number, status, marketplace badge, back nav
 *   2. Reconciliation banner — state-machine signal + next-step copy
 *   3. KPI grid — sale net / estimated profit / settled profit / margin
 *   4. VAT breakdown — net+VAT aggregate of items
 *   5. Fee timeline — chronological OrderFee rows with confirmedAt pairing
 *   6. Items table — per-line variant + commission split + cost snapshot
 *   7. Claims card — PR-13 graceful empty until GetClaims worker ships
 */
export function OrderDetailClient({
  orgId,
  storeId,
  orderId,
  chrome = 'page',
}: OrderDetailClientProps): React.ReactElement {
  const t = useTranslations('orderDetail');
  // Dışlama sebebi kopyası tek kaynaktan (kâr-dışı liste hücresiyle aynı namespace).
  const tReason = useTranslations('exclusionReasons');
  const formatter = useFormatter();
  const router = useRouter();

  const noContext = orgId === null || storeId === null;

  const orderQuery = useOrder(noContext ? null : { orgId, storeId, orderId });

  if (noContext) {
    return (
      <>
        {chrome === 'page' && <PageHeader title={t('title.placeholder')} />}
        <Alert tone="warning" size="md">
          <AlertDescription>{t('errors.noStoreContext')}</AlertDescription>
        </Alert>
      </>
    );
  }

  if (orderQuery.isLoading) {
    return <LoadingState chrome={chrome} />;
  }

  if (orderQuery.error !== null) {
    const notFound = orderQuery.error instanceof ApiError && orderQuery.error.status === 404;
    return (
      <>
        {chrome === 'page' && <PageHeader title={t('title.placeholder')} />}
        <Alert tone={notFound ? 'neutral' : 'destructive'} size="md">
          <AlertDescription>
            {notFound ? t('errors.notFound') : t('errors.loadFailed')}
          </AlertDescription>
        </Alert>
        {chrome === 'page' && (
          <div>
            <Button variant="outline" onClick={() => router.push('/orders')}>
              <ArrowLeft01Icon className="size-icon-sm" />
              {t('backToList')}
            </Button>
          </div>
        )}
      </>
    );
  }

  const order = orderQuery.data;
  if (order === undefined) {
    return <LoadingState chrome={chrome} />;
  }

  const headerTitle = order.platformOrderNumber ?? order.platformOrderId;

  // Kâr-dışı banner açıklaması sebebe özel + sade (kâr-dışı liste hücresiyle aynı
  // `exclusionReasons` kaynağı, tek cümle, jargonsuz). reason null (CHECK gereği
  // olmamalı) → generic metne düşer. profitExcludedAt null ise banner çizilmez.
  const exclusionDescription =
    order.profitExcludedAt === null
      ? null
      : ((): string => {
          switch (order.profitExclusionReason) {
            case 'COST_DEADLINE_MISSED':
              return tReason('COST_DEADLINE_MISSED.detail');
            case 'LATE_UNCOSTED_ARRIVAL':
              return tReason('LATE_UNCOSTED_ARRIVAL.detail');
            case 'LEGACY_BACKFILL':
              return tReason('LEGACY_BACKFILL.detail');
            default:
              return t('exclusion.description');
          }
        })();

  return (
    <div className="gap-lg flex flex-col">
      {chrome === 'page' && (
        <>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/orders')}
              className="gap-3xs"
            >
              <ArrowLeft01Icon className="size-icon-sm" />
              {t('backToList')}
            </Button>
          </div>
          <PageHeader
            title={headerTitle}
            intent={t('intent', {
              date: formatter.dateTime(new Date(order.orderDate), 'long'),
            })}
            meta={
              <div className="gap-xs flex flex-wrap items-center">
                <MarketplaceLogo
                  platform={order.store.platform}
                  alt={order.store.platform}
                  className="size-icon-md"
                />
                <span className="text-sm">{order.store.name}</span>
                <OrderStatusBadge status={order.status} />
                <ReconciliationStatusBadge status={order.reconciliationStatus} />
              </div>
            }
          />
        </>
      )}

      <OrderStatusBanner order={order} />

      {/* Kalıcı kâr-dışı banner'ı (spec 2026-06-12 §7): pencere kaçtı, dışlama
          geri dönüşsüz — satıcı nedenini (sebebe özel) ve tarihini her zaman görür. */}
      {exclusionDescription !== null ? (
        <Alert tone="warning" size="md">
          <AlertTitle>{t('exclusion.title')}</AlertTitle>
          <AlertDescription>{exclusionDescription}</AlertDescription>
        </Alert>
      ) : null}

      <OrderKpiGrid order={order} dense={chrome === 'modal'} />

      <OrderDeliverySection order={order} />

      <div className="gap-lg grid grid-cols-1 lg:grid-cols-2">
        <ProfitBreakdownCard
          breakdown={order.profitBreakdown}
          promotionDisplays={order.promotionDisplays}
          micro={order.micro}
        />
        <OrderFeeTimeline fees={order.fees} />
      </div>

      <OrderItemsList items={order.items} profitExcluded={order.profitExcludedAt !== null} />

      <OrderClaimsCard claims={order.claims} />
    </div>
  );
}

function LoadingState({ chrome }: { chrome: 'page' | 'modal' }): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      {/* Back-nav block exists only in page chrome — the modal host (Sheet)
          owns its own header + close, so the skeleton must not preview one. */}
      {chrome === 'page' ? <Skeleton className="h-10 w-48" /> : null}
      <Skeleton className="h-24 w-full" />
      {/* Mirrors OrderKpiGrid: dense (modal) stays 2-col, page widens to 4-col. */}
      <div
        className={cn(
          'gap-md grid grid-cols-1 sm:grid-cols-2',
          chrome === 'page' && 'lg:grid-cols-4',
        )}
      >
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <div className="gap-lg grid grid-cols-1 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
