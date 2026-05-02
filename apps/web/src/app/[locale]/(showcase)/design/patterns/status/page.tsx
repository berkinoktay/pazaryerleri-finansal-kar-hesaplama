'use client';

import * as React from 'react';

import { Banner } from '@/components/patterns/banner';
import { NotificationBell, type NotificationEntry } from '@/components/patterns/notification-bell';
import { PageHeader } from '@/components/patterns/page-header';
import { RailWarningCard } from '@/components/patterns/rail-warning-card';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

const MOCK_SYNC_REF = new Date('2026-04-20T21:00:00Z');
const MOCK = {
  syncFresh: new Date(MOCK_SYNC_REF.getTime() - 2 * 60 * 1000),
  syncStale: new Date(MOCK_SYNC_REF.getTime() - 45 * 60 * 1000),
  syncing: new Date(MOCK_SYNC_REF.getTime() - 30 * 1000),
  syncFailed: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 60 * 1000),
};

const NOTIFICATION_ENTRIES: NotificationEntry[] = [
  {
    id: '1',
    icon: 'success',
    title: 'Trendyol senkronizasyonu tamamlandı — 142 yeni sipariş',
    timestamp: '2 dk önce',
    source: 'Trendyol Ana Mağaza',
  },
  {
    id: '2',
    icon: 'warning',
    title: '3 ürünün maliyet bilgisi eksik',
    timestamp: '1 saat önce',
    source: 'Karlılık',
  },
  {
    id: '3',
    icon: 'info',
    title: 'Nisan 2026 hakediş raporu hazır',
    timestamp: '3 saat önce',
  },
];

const SYNC_CENTER_LOGS: SyncCenterLog[] = [
  {
    id: 'log-1',
    syncType: 'PRODUCTS',
    status: 'RUNNING',
    startedAt: new Date(MOCK_SYNC_REF.getTime() - 30 * 1000).toISOString(),
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: 142,
    progressTotal: 250,
    errorCode: null,
  },
  {
    id: 'log-2',
    syncType: 'PRODUCTS',
    status: 'COMPLETED',
    startedAt: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(MOCK_SYNC_REF.getTime() - 3.5 * 60 * 60 * 1000).toISOString(),
    recordsProcessed: 480,
    progressCurrent: 480,
    progressTotal: 480,
    errorCode: null,
  },
  {
    id: 'log-3',
    syncType: 'PRODUCTS',
    status: 'FAILED',
    startedAt: new Date(MOCK_SYNC_REF.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(MOCK_SYNC_REF.getTime() - 24 * 60 * 60 * 1000 + 30 * 1000).toISOString(),
    recordsProcessed: 0,
    progressCurrent: 0,
    progressTotal: null,
    errorCode: 'MARKETPLACE_AUTH_FAILED',
  },
];

export default function StatusPatternsPage(): React.ReactElement {
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Durum & sync pattern'ları"
        intent="Veri güncelliği, hata bildirimleri, çalışan iş takibi: SyncBadge, SyncCenter, NotificationBell, RailWarningCard."
      />
      <PatternNav />

      <Preview
        title="SyncBadge"
        description="Verinin güncelliğini tek bakışta iletir. Timezone açık (GMT+3), kaynak pazaryeri görünür. fresh / stale / syncing / failed lifecycle state'leri."
      >
        <div className="gap-xs flex flex-col">
          <SyncBadge state="fresh" lastSyncedAt={MOCK.syncFresh} source="Trendyol" />
          <SyncBadge state="stale" lastSyncedAt={MOCK.syncStale} source="Trendyol" />
          <SyncBadge state="syncing" lastSyncedAt={MOCK.syncing} source="Trendyol" />
          <SyncBadge state="failed" lastSyncedAt={MOCK.syncFailed} source="Hepsiburada" />
        </div>
      </Preview>

      <Preview
        title="SyncBadge — interaktif (SyncCenter giriş noktası)"
        description="onClick verildiğinde Badge clickable button'a dönüşür. Genelde SyncCenter sheet'ini açar."
      >
        <SyncBadge
          state="syncing"
          lastSyncedAt={MOCK.syncing}
          source="Trendyol"
          onClick={() => setSyncCenterOpen(true)}
          ariaLabel="Sync detayını aç"
        />
        <SyncCenter
          open={syncCenterOpen}
          onOpenChange={setSyncCenterOpen}
          logs={SYNC_CENTER_LOGS}
          triggers={[]}
        />
      </Preview>

      <Preview
        title="SyncCenter (sheet)"
        description="Aktif + son tamamlanan + hatalı sync'leri gösterir. Triggers slot'una 'Şimdi senkronize et' butonu konur. Mağaza bazlı gruplama otomatik (2+ mağaza → header)."
      >
        <Button variant="outline" onClick={() => setSyncCenterOpen(true)}>
          SyncCenter&apos;ı aç
        </Button>
        <span className="text-2xs text-muted-foreground">
          (Yukarıdaki interaktif Badge ile aynı sheet&apos;i açar.)
        </span>
      </Preview>

      <Preview
        title="NotificationBell"
        description="Sayfa header'ının `actions` slot'unda yaşar. unreadCount > 0 → kırmızı sayı; > 9 → '9+'. Popover içeride en son 5 entry + '/notifications' linki."
      >
        <div className="gap-md flex items-center">
          <NotificationBell entries={NOTIFICATION_ENTRIES} unreadCount={3} />
          <NotificationBell entries={NOTIFICATION_ENTRIES} unreadCount={12} />
          <NotificationBell entries={[]} unreadCount={0} />
          <span className="text-2xs text-muted-foreground">
            Soldan: 3 unread · 12 (clamp 9+) · 0 (boş popover)
          </span>
        </div>
      </Preview>

      <Preview
        title="Banner"
        description="Uygulama-spanning sistem mesajı. AppShell'in en üstünde, Sidebar header'ının üstünde yaşar — bakım pencereleri, ödeme gecikmesi, planlı kesinti, çoklu-gün incident'lar. Alert (sayfa-içi) ve Toast (geçici) ile farkı: 'çözülene kadar her ekranı etkiler'. Az kullan — daima orada olan banner kör nokta haline gelir."
      >
        <div className="border-border gap-3xs flex flex-col overflow-hidden rounded-md border">
          <Banner
            tone="info"
            title="Bakım penceresi"
            description="2 Mayıs 03:00 – 03:30 UTC arası kısa kesinti olabilir."
            action={
              <Link
                href="#"
                className="text-info hover:bg-info-surface px-xs py-3xs text-2xs rounded-xs font-medium underline-offset-4 hover:underline"
              >
                Detay
              </Link>
            }
            onDismiss={() => undefined}
          />
          <Banner
            tone="warning"
            title="Ödeme yöntemin yakında dolacak"
            description="VISA •••• 4242 son kullanma 06/2026."
            action={
              <Link
                href="#"
                className="text-warning hover:bg-warning-surface px-xs py-3xs text-2xs rounded-xs font-medium underline-offset-4 hover:underline"
              >
                Faturalama ayarları
              </Link>
            }
          />
          <Banner
            tone="destructive"
            title="Trendyol API'sine ulaşılamıyor"
            description="Sipariş senkronizasyonu duraklatıldı. Servis durumu güncellemeleri için status sayfasını izle."
            action={
              <Link
                href="#"
                className="text-destructive hover:bg-destructive-surface px-xs py-3xs text-2xs rounded-xs font-medium underline-offset-4 hover:underline"
              >
                Status sayfası
              </Link>
            }
          />
          <Banner
            tone="success"
            title="Aprilik faturalandırma tamamlandı"
            description="Tüm mağazaların hakediş raporları hazır."
            onDismiss={() => undefined}
          />
        </div>
      </Preview>

      <Preview
        title="RailWarningCard"
        description="ContextRail'in ortasında — sadece eyleme dönüştürülebilir bir sorun varken görünür. tone='warning' (eksik maliyet, stale sync) veya 'destructive' (auth hatası, sync başarısız)."
      >
        <div className="max-w-input gap-sm grid">
          <RailWarningCard
            title="3 ürünün maliyet bilgisi eksik"
            description="Karlılık raporu eksik kalır. Maliyetleri tamamla."
            ctaLabel="Maliyetleri ekle"
            ctaHref="/dashboard/products"
            tone="warning"
          />
          <RailWarningCard
            title="Hepsiburada API bağlantısı kesildi"
            description="Sipariş senkronizasyonu duruyor. Şimdi yeniden bağlan."
            ctaLabel="Şimdi bağlan"
            ctaHref="/dashboard/settings"
            tone="destructive"
          />
        </div>
      </Preview>
    </>
  );
}
