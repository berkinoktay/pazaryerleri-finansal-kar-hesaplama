'use client';

import * as React from 'react';

import { Banner } from '@/components/patterns/banner';
import { NotificationBell, type NotificationEntry } from '@/components/patterns/notification-bell';
import { PageHeader } from '@/components/patterns/page-header';
import { RailWarningCard } from '@/components/patterns/rail-warning-card';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { ActivityFeedShowcase } from '../activity-feed-showcase';
import { ConfirmDialogShowcase } from '../confirm-dialog-showcase';
import { StepperShowcase } from '../stepper-showcase';
import { WizardShowcase } from '../wizard-showcase';

// Fixed ISO reference so the relative-time labels never read a runtime clock at
// module scope (SSR-safe). The badge swaps to a relative label after mount.
const MOCK_SYNC_REF = new Date('2026-04-20T21:00:00Z');
const MOCK_SYNCING_AT = new Date(MOCK_SYNC_REF.getTime() - 30 * 1000);

// SyncBadge's only config prop is `state`; tone is derived from it (failed →
// destructive, stale/retrying → warning, syncing → info, fresh → neutral).
const SYNC_STATES: readonly SyncState[] = ['fresh', 'stale', 'syncing', 'retrying', 'failed'];

// Banner exposes a 4-tone vocabulary (no neutral/primary) — local const so the
// Playground options match the real BannerTone union exactly.
const BANNER_TONES = ['info', 'success', 'warning', 'destructive'] as const;

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
  // Single SyncCenter instance for the whole page — both the interactive
  // SyncBadge and the standalone trigger open this one sheet.
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Durum & sync pattern'ları"
        intent="Veri güncelliği, hata bildirimleri, çalışan iş takibi: SyncBadge, SyncCenter, NotificationBell, Banner, Stepper, Wizard, ActivityFeed, ConfirmDialog, RailWarningCard."
      />
      <CategoryNav section="patterns" />

      <ShowcaseSection
        title="SyncBadge & SyncCenter"
        description="Verinin güncelliğini tek bakışta iletir ve çalışan sync'lere giriş noktası olur. state lifecycle'ı (fresh / stale / syncing / retrying / failed) ikon + tone'u sürer; tone state'ten türetilir."
      >
        <Playground
          title="SyncBadge — state · source"
          description="Tek config prop'u state; tone otomatik türetilir (failed→destructive, stale/retrying→warning, syncing→info, fresh→nötr). lastSyncedAt sabit mock; mount sonrası göreli zamana döner."
          controls={{
            state: control.segment(SYNC_STATES, 'fresh'),
            source: control.text('Trendyol', 'source', 'Pazaryeri adı'),
          }}
          render={(v) => (
            <SyncBadge
              state={v.state}
              lastSyncedAt={MOCK_SYNC_REF}
              source={v.source === '' ? undefined : v.source}
            />
          )}
        />

        <Preview
          title="SyncBadge — interaktif (SyncCenter giriş noktası)"
          description="onClick verildiğinde Badge clickable button'a dönüşür ve SyncCenter sheet'ini açar. Aşağıdaki standalone tetikleyici de aynı sheet'i açar."
        >
          <div className="gap-md flex flex-wrap items-center">
            <SyncBadge
              state="syncing"
              lastSyncedAt={MOCK_SYNCING_AT}
              source="Trendyol"
              onClick={() => setSyncCenterOpen(true)}
              ariaLabel="Sync detayını aç"
            />
            <Button variant="outline" onClick={() => setSyncCenterOpen(true)}>
              SyncCenter&apos;ı aç
            </Button>
          </div>
        </Preview>

        <Preview
          title="SyncCenter (sheet)"
          description="Aktif + son tamamlanan + hatalı sync'leri gösterir. Triggers slot'una 'Şimdi senkronize et' butonu konur. Mağaza bazlı gruplama otomatik (2+ mağaza → header)."
        >
          <span className="text-2xs text-muted-foreground">
            Yukarıdaki interaktif Badge ya da &quot;SyncCenter&apos;ı aç&quot; butonu bu
            sheet&apos;i açar — sayfada tek instance olarak mount edilir.
          </span>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Banner & NotificationBell"
        description="Uygulama-spanning sistem mesajı (Banner) ve header'daki bildirim girişi (NotificationBell). Banner çözülene kadar her ekranı etkiler; Alert (sayfa-içi) ve Toast (geçici) ile farkı budur."
      >
        <Playground
          title="Banner — tone · action · dismiss"
          description="tone bg + foreground + varsayılan ikonu sürer. action trailing slot'a deep-link koyar; onDismiss sağa kapatma butonu ekler. Az kullan — daima orada olan banner kör nokta olur."
          controls={{
            tone: control.segment(BANNER_TONES, 'info'),
            action: control.bool(true, 'action'),
            dismissible: control.bool(true, 'dismissible'),
          }}
          render={(v) => (
            <Banner
              tone={v.tone}
              title="Bakım penceresi"
              description="2 Mayıs 03:00 – 03:30 UTC arası kısa kesinti olabilir."
              className="w-full rounded-md border"
              action={
                v.action ? (
                  <Link
                    href="#"
                    className="hover:bg-muted px-xs py-3xs text-2xs rounded-xs font-medium underline-offset-4 hover:underline"
                  >
                    Detay
                  </Link>
                ) : undefined
              }
              onDismiss={v.dismissible ? () => undefined : undefined}
              dismissLabel="Kapat"
            />
          )}
        />

        <Preview
          title="Banner — gerçek dünya tonları (yığılı)"
          description="AppShell'in en üstünde, Sidebar header'ının üstünde tek bir kolon olarak yaşar. Her tone'un kendi deep-link aksiyonu var; tonların yan yana okunuşu için."
        >
          <div className="border-border gap-3xs flex flex-col overflow-hidden rounded-md border">
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
              title="Nisan faturalandırması tamamlandı"
              description="Tüm mağazaların hakediş raporları hazır."
              onDismiss={() => undefined}
              dismissLabel="Kapat"
            />
          </div>
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
      </ShowcaseSection>

      <ShowcaseSection
        title="Stepper & Wizard"
        description="Çok-adımlı akışta nerede olduğunu gösteren Stepper ve onu içerik panesi + Back/Next footer ile birleştiren Wizard organism'i. Wizard kendi Stepper'ını içeride gösterir — burada Stepper bir kez standalone, bir kez Wizard içinde görünür."
      >
        <StepperShowcase />

        <Preview
          title="Wizard"
          description="Çok-adımlı akış kabuğu. Stepper (üst) + içerik panesi + Back/Next footer. Controlled cursor — caller current'ı sahipler, URL/searchparam ile kalıcılaştırılabilir. Per-step canAdvance (Next disable), nextLabel (per-step copy), onAdvance (async — verify gibi) destekler. Mağaza bağlama, hakediş yükleme, onboarding redesign için."
        >
          <WizardShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="ActivityFeed, ConfirmDialog & RailWarningCard"
        description="Kronolojik olay listesi, onay diyaloğu ve ContextRail uyarı kartı — hepsi orkestre davranış (kompozisyon, async akış) içerdiğinden Preview olarak kalır."
      >
        <Preview
          title="ActivityFeed"
          description="Kronolojik olay listesi — sync geçmişi, audit log, mutabakat olayları için. Per-entry tone (success/warning/destructive/info/neutral), opsiyonel icon-in-circle, opsiyonel detail paneli. Connector çizgisi entryler arası. compact varyantı sidebar/context-rail için. Boş durum slotu EmptyState ile birleşir."
        >
          <ActivityFeedShowcase />
        </Preview>

        <Preview
          title="ConfirmDialog"
          description="AlertDialog üstüne canonical Cancel-sol / Confirm-sağ footer'ı sarıyor. Hem trigger-based (kendi state'i) hem controlled (caller open + onOpenChange) destekler. onConfirm async — promise pending iken iki buton disabled, confirm butonu spinner ile değişir; reject ise dialog açık kalır. tone='destructive' (default — silme, kapatma) ya da tone='default' (geri alınabilir aksiyon)."
        >
          <ConfirmDialogShowcase />
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
      </ShowcaseSection>

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={SYNC_CENTER_LOGS}
        triggers={[]}
      />
    </>
  );
}
