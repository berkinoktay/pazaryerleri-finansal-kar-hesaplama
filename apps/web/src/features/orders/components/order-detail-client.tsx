'use client';

import { ArrowLeft01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { StatStrip } from '@/components/patterns/stat-strip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-error';

import { buildOrderKpiStripItems } from '../lib/order-kpi-strip-items';
import { useOrder } from '../hooks/use-order';

import { OrderItemsList } from './order-items-list';
import { OrderProfitHero } from './order-profit-hero';
import { OrderProfitSummary } from './order-profit-summary';
import { OrderStatusBadge } from './order-status-badge';
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
  // KPI şeridi (sayfa yolu) OrderKpiGrid ile AYNI kaynağı kullanır.
  const tKpis = useTranslations('orderDetail.kpis');
  // Dışlama sebebi kopyası tek kaynaktan (kâr-dışı liste hücresiyle aynı namespace).
  const tReason = useTranslations('exclusionReasons');
  const formatter = useFormatter();
  const router = useRouter();

  const noContext = orgId === null || storeId === null;

  const orderQuery = useOrder(noContext ? null : { orgId, storeId, orderId });

  if (noContext) {
    return (
      <>
        {chrome === 'page' && <PageHeader variant="framed" title={t('title.placeholder')} />}
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
        {chrome === 'page' && <PageHeader variant="framed" title={t('title.placeholder')} />}
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
        <PageHeader
          variant="framed"
          leading={
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/orders')}
              leadingIcon={<ArrowLeft01Icon aria-hidden />}
            >
              {t('backToList')}
            </Button>
          }
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
          summary={
            <StatStrip surface="bare" size="md" items={buildOrderKpiStripItems(order, tKpis)} />
          }
        />
      )}

      {/* Kalıcı kâr-dışı banner'ı (spec 2026-06-12 §7): pencere kaçtı, dışlama
          geri dönüşsüz — satıcı nedenini (sebebe özel) ve tarihini her zaman görür. */}
      {exclusionDescription !== null ? (
        <Alert tone="warning" size="md">
          <AlertTitle>{t('exclusion.title')}</AlertTitle>
          <AlertDescription>{exclusionDescription}</AlertDescription>
        </Alert>
      ) : null}

      {/* İade durum bandı (Seçenek A): iade varsa öne çıkar; kâr dökümündeki
          tutarlar zaten iade sonrası nettir. GetClaims worker gelene dek çoğu
          siparişte boş. */}
      {order.claims.length > 0 ? (
        <Alert tone="warning" size="md">
          <AlertTitle>{t('returnBanner.title')}</AlertTitle>
          <AlertDescription>
            {t('returnBanner.description', { count: order.claims.length })}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Profit-led + odaklı: sonuç (hero) → siparişteki ürünler (resimlerle) →
          kâr dökümü (gelir + gruplu tahsis + öneri). Ücret zaman çizgisi, iade
          talepleri ve teslimat bilinçli olarak kaldırıldı — sheet yalnız kâr
          hikâyesine odaklanır. */}
      <OrderProfitHero
        breakdown={order.profitBreakdown}
        reconciliationStatus={order.reconciliationStatus}
      />

      <OrderItemsList items={order.items} profitExcluded={order.profitExcludedAt !== null} />

      <OrderProfitSummary
        breakdown={order.profitBreakdown}
        promotionDisplays={order.promotionDisplays}
        micro={order.micro}
      />
    </div>
  );
}

function LoadingState({ chrome }: { chrome: 'page' | 'modal' }): React.ReactElement {
  const tCommon = useTranslations('common');

  // Page path mirrors the campaign detail loading anatomy: a framed header with a
  // back link and a 4-cell bare summary strip, matching the loaded page chrome
  // (framed PageHeader + bare StatStrip) so nothing jumps when the order lands.
  if (chrome === 'page') {
    return <PageSkeleton label={tCommon('loading')} framed withBackLink statCells={4} />;
  }

  // Modal path: the Sheet/Dialog host owns its header + close, so the skeleton
  // previews no back-nav and keeps the dense 2-col grid that mirrors the dense
  // OrderKpiGrid the modal chrome renders.
  return (
    <div className="gap-lg flex flex-col">
      <Skeleton className="h-24 w-full" />
      <div className="gap-md grid grid-cols-1 sm:grid-cols-2">
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
