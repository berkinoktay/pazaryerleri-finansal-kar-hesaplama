'use client';

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Database01Icon,
  Loading03Icon,
  RefreshIcon,
} from 'hugeicons-react';
import * as React from 'react';

import { ActivityFeed, type ActivityFeedEntry } from '@/components/patterns/activity-feed';
import { EmptyState } from '@/components/patterns/empty-state';
import { Playground, control } from '@/components/showcase/playground';

const SYNC_HISTORY: ActivityFeedEntry[] = [
  {
    id: 'sync-running',
    tone: 'info',
    icon: <Loading03Icon className="animate-spin" />,
    title: 'Ürün senkronizasyonu çalışıyor',
    description: '142 / 250 ürün işlendi.',
    source: 'Trendyol Ana Mağaza',
    timestamp: 'şimdi',
  },
  {
    id: 'orders-completed',
    tone: 'success',
    icon: <CheckmarkCircle02Icon />,
    title: 'Sipariş senkronizasyonu tamamlandı',
    description: '34 yeni sipariş eklendi, 12 sipariş güncellendi.',
    source: 'Trendyol Ana Mağaza',
    timestamp: '8 dk önce',
  },
  {
    id: 'rate-limit',
    tone: 'warning',
    icon: <Alert02Icon />,
    title: 'API rate-limit yaklaşıldı',
    description: 'Pazaryeri 60 sn için yavaşlatıldı; otomatik geri çekilme aktif.',
    source: 'Hepsiburada Acme',
    timestamp: '1 saat önce',
    detail: (
      <>
        Endpoint: <code>/orders</code> · 80 / 100 req/dk · backoff 60s
      </>
    ),
  },
  {
    id: 'auth-failed',
    tone: 'destructive',
    icon: <Alert02Icon />,
    title: 'API kimlik doğrulaması başarısız',
    description:
      'Mağaza API anahtarı geçersiz görünüyor. Yeniden bağlanmak için Ayarlar > Mağazalar.',
    source: 'Trendyol İstanbul',
    timestamp: '4 saat önce',
  },
  {
    id: 'manual-trigger',
    tone: 'neutral',
    icon: <RefreshIcon />,
    title: 'Manuel senkron başlatıldı',
    description: 'Berkin Oktay tarafından panelden tetiklendi.',
    timestamp: 'Dün 18:42',
  },
];

export function ActivityFeedShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="ActivityFeed — compact · showConnector"
        description="Per-entry tone + icon-in-circle + opsiyonel detail paneli içerik tarafında yaşar (config değil). compact sidebar/context-rail ritmine geçirir; showConnector entryler arası dikey çizgiyi açar/kapar."
        controls={{
          compact: control.bool(false, 'compact'),
          showConnector: control.bool(true, 'showConnector'),
        }}
        render={(v) => (
          <div className="border-border bg-card p-md w-full rounded-md border">
            <ActivityFeed
              entries={SYNC_HISTORY}
              compact={v.compact}
              showConnector={v.showConnector}
              aria-label="Senkronizasyon geçmişi"
            />
          </div>
        )}
      />

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş durum — emptyState slotu (EmptyState ile birleşir)
        </span>
        <div className="border-border bg-card p-md rounded-md border">
          <ActivityFeed
            entries={[]}
            aria-label="Aktivite yok"
            emptyState={
              <EmptyState
                icon={Database01Icon}
                title="Henüz aktivite yok"
                description="İlk senkron tamamlandığında burada görünecek."
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
