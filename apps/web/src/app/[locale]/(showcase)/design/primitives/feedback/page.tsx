'use client';

import { DeliveryBox01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CountBadge } from '@/components/ui/count-badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusDot } from '@/components/ui/status-dot';
import { RADIUS_KEYS, SIZE_KEYS, TONE_KEYS } from '@/lib/variants';

// Alert's tone union is narrower than the full TONE_KEYS (no `primary`) — it
// carries semantic message meaning + a default leading icon per tone.
const ALERT_TONES = ['neutral', 'info', 'success', 'warning', 'destructive'] as const;

export default function FeedbackPrimitivePage(): React.ReactElement {
  const t = useTranslations('common');

  return (
    <>
      <PageHeader
        title="Geri bildirim"
        intent="Alert, Toast, Progress, Spinner, StatusDot, Skeleton, CountBadge — kullanıcıya ne olduğunu anlatan her şey. Tone/size/radius gibi konfig prop'larını kontrol şeritlerinden canlı çevir; etkileşim (kapatma, async, canlı değer) Preview olarak kalır."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Alert"
        description="Bölüm-içi semantik mesaj. Icon prop verilmezse tone'a göre otomatik (info → i, success → check, warning/destructive → uyarı). Varsayılan kenarlıksız (sakin yüzen bilgi); hasBorder YALNIZ warning/destructive'te ton-kenarlığı firmleştirir. Yan-şerit border yasak."
      >
        <Playground
          title="Alert — tone · size · radius · hasBorder · dismiss · icon"
          description="Eski 'her tonu statik grid'de tekrar et' + onDismiss + icon-opt-out bloklarının yerini alır. icon kapalıyken tone default'u bastırılır (metin tam genişlikte akar); dismiss açıkken sağ üstte 44px touch-target X belirir."
          controls={{
            tone: control.segment(ALERT_TONES, 'warning'),
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            hasBorder: control.bool(false, 'hasBorder'),
            dismiss: control.bool(false, 'dismiss'),
            icon: control.bool(true, 'icon'),
          }}
          render={(v) => (
            <Alert
              tone={v.tone}
              size={v.size}
              radius={v.radius}
              hasBorder={v.hasBorder}
              icon={v.icon ? undefined : null}
              dismissLabel={t('dismiss')}
              onDismiss={v.dismiss ? () => undefined : undefined}
              className="max-w-form"
            >
              <AlertTitle>3 ürünün maliyet bilgisi eksik</AlertTitle>
              <AlertDescription>
                Bu ürünler karlılık raporuna dahil edilmiyor. Maliyetler eklenmeden net kar eksik
                kalır.
              </AlertDescription>
            </Alert>
          )}
        />

        <Preview
          title="Alert — onDismiss (etkileşimli kapatma)"
          description="onDismiss prop, aria-label i18n'den, 44px touch target (pointer-coarse:). Her uyarıyı tek tek kapatıp boş-durumu gör — kapatma bileşenin sahip olduğu davranıştır, kontrolle ifade edilmez."
        >
          <AlertDismissDemo dismissLabel={t('dismiss')} />
        </Preview>

        <Preview
          title="Alert — action slot"
          description="action slot'u CTA Button'ı bileşen içinde tutar — focus + layout primitive'de. Yüksek-riskli/geri-dönüşsüz uyarılarda hasBorder ile ton-kenarlığı firmleşir."
        >
          <Alert
            tone="destructive"
            hasBorder
            action={{ label: 'Ayarlara git', onClick: () => undefined }}
            className="max-w-form"
          >
            <AlertTitle>Hepsiburada API bağlantısı başarısız</AlertTitle>
            <AlertDescription>401 Unauthorized — API bilgilerini güncelle.</AlertDescription>
          </Alert>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Toast (Sonner)"
        description="İkon + kalın başlık + sönük açıklama. Tona göre tinted + ton-kenarlık (success toast = success Alert): success=yeşil check, error=destructive, warning=üçgen, info=i, loading=spinner. Nötr toast(): bg-card. Tetikleyici grid bir davranıştır (async + sağ-alt mount) — Playground'a indirgenmez."
      >
        <Preview
          title="Toast tetikleyicileri"
          description="Custom icon (soft-square) + action + close butonu. Butona tıkla → sağ altta toast belirir."
        >
          <div className="gap-xs flex flex-wrap">
            <Button
              variant="outline"
              onClick={() =>
                toast('Taslak otomatik kaydedildi', { description: 'Dilersen kapat.' })
              }
            >
              Neutral
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.success('Senkronizasyon tamamlandı', {
                  description: '142 yeni sipariş çekildi.',
                })
              }
            >
              Success
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.warning('3 satır eksik veri', { description: 'Maliyetler eksik kalır.' })
              }
            >
              Warning
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error('Bağlantı başarısız', {
                  description: 'İnternet bağlantını kontrol et.',
                })
              }
            >
              Error
            </Button>
            <Button
              variant="outline"
              onClick={() => toast.info('Bakım planlandı', { description: 'Bu gece 02:00.' })}
            >
              Info
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.loading('Proje verileri senkronize ediliyor…', { duration: 3000 })
              }
            >
              Loading
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast('Mesaj arşivlendi', {
                  description: 'Konuşma arşiv klasörüne taşındı.',
                  action: { label: 'Geri al', onClick: () => toast.info('Geri alındı') },
                })
              }
            >
              With action
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast('Sipariş yola çıktı', {
                  description: 'Kuryeniz birkaç blok uzakta.',
                  icon: (
                    <span className="bg-warning-surface text-warning flex size-7 items-center justify-center rounded-md">
                      <DeliveryBox01Icon className="size-icon-sm" />
                    </span>
                  ),
                })
              }
            >
              Custom icon
            </Button>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Progress"
        description="value bilinince determinate (220ms ease-out-quart geçiş); value yok = indeterminate sweep (bilinmeyen süre, reduced-motion'da statik dolu). radius varsayılan md (form chrome ailesi). tone eşik sinyali (100%=success, eşik üstü=warning); size bar yüksekliği."
      >
        <Playground
          title="Progress — tone · size · radius · indeterminate"
          description="indeterminate açıkken value bırakılır → bilinmeyen-süre sweep'i; kapalıyken sabit %64 determinate dolgu. tone eşik sinyalini taşır (success @100, warning eşik üstü)."
          controls={{
            tone: control.select(TONE_KEYS, 'primary'),
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            indeterminate: control.bool(false, 'indeterminate'),
          }}
          render={(v) => (
            <Progress
              tone={v.tone}
              size={v.size}
              radius={v.radius}
              value={v.indeterminate ? undefined : 64}
              aria-label="Senkronizasyon ilerlemesi"
              className="max-w-form"
            />
          )}
        />

        <Preview
          title="Progress — canlı determinate değer"
          description="value prop'u canlı değişince dolgu 220ms ease-out-quart ile kayar. Değeri bileşenin tüketicisi yönetir — Playground'da değil, gerçek state ile gör."
        >
          <ProgressLiveDemo />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Spinner"
        description="CSS dönen yay. Varsayılan currentColor miras alır (Button/Select loading'de 16px değişmeden oturur). size sm(12)/md(16)/lg(20); tone bağımsız durum göstergesi için (async başarı = success spinner). prefers-reduced-motion global olarak dönüşü durdurur (fonksiyonel sürekli motion)."
      >
        <Preview
          title="Spinner — size · tone"
          description="Sürekli fonksiyonel motion; durum bir davranıştır, küçük bir referans grid yeter. Button loading durumu Buton sayfasında: /design/primitives/buttons."
        >
          <div className="gap-lg flex flex-wrap items-center">
            <div className="gap-md flex items-center">
              <Spinner size="sm" label={t('loading')} />
              <Spinner size="md" label={t('loading')} />
              <Spinner size="lg" label={t('loading')} />
            </div>
            <div className="gap-md flex items-center">
              <Spinner tone="primary" label={t('loading')} />
              <Spinner tone="success" label={t('loading')} />
              <Spinner tone="warning" label={t('loading')} />
              <Spinner tone="destructive" label={t('loading')} />
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">
            Button loading durumu → /design/primitives/buttons
          </p>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="StatusDot"
        description="Renkli nokta + opsiyonel inline label (label slot'u → text erişilebilir ad, nokta dekoratif). animatePulse aktif-senkron 'alive' göstergesi (org-switcher bunu kullanır). Renk asla tek sinyal değil — yanında daima etiket/ikon. Kanonik ev burası."
      >
        <Playground
          title="StatusDot — tone · size · animatePulse · label"
          description="label açıkken metin erişilebilir adı taşır (nokta dekoratif); kapalıyken bare nokta (çağıran komşu etiket/ikon sağlar). animatePulse genişleyen 'live' halkasıdır (reduced-motion'da düz noktaya çöker)."
          controls={{
            tone: control.select(TONE_KEYS, 'success'),
            size: control.segment(SIZE_KEYS, 'md'),
            animatePulse: control.bool(false, 'animatePulse'),
            label: control.bool(true, 'label'),
          }}
          render={(v) => (
            <StatusDot
              tone={v.tone}
              size={v.size}
              animatePulse={v.animatePulse}
              label={
                v.label ? (
                  <span className="text-sm">Trendyol Ana Mağaza · senkronize</span>
                ) : undefined
              }
            />
          )}
        />

        <Preview
          title="StatusDot — mağaza durum listesi (bağlamda)"
          description="Gerçek kullanım: her satırda nokta + senkron durumu metni. Nokta dekoratif, metin sinyali taşır — renk tek başına asla yeterli değil."
        >
          <div className="gap-md flex flex-col">
            <div className="gap-xs flex items-center">
              <StatusDot tone="success" />
              <span className="text-foreground text-sm">Trendyol Ana Mağaza · senkronize</span>
            </div>
            <div className="gap-xs flex items-center">
              <StatusDot tone="warning" />
              <span className="text-foreground text-sm">Hepsiburada · 2 saat önce</span>
            </div>
            <div className="gap-xs flex items-center">
              <StatusDot tone="destructive" />
              <span className="text-foreground text-sm">
                Trendyol Hediyelik · senkronizasyon başarısız
              </span>
            </div>
            <div className="gap-xs flex items-center">
              <StatusDot tone="info" />
              <span className="text-foreground text-sm">Yeni özellik aktif</span>
            </div>
            <div className="gap-xs flex items-center">
              <StatusDot tone="neutral" />
              <span className="text-muted-foreground text-sm">Pasif mağaza</span>
            </div>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Skeleton"
        description="İlk yüklemede spinner yerine içerik iskeleti. radius varsayılan sm (input/text-line köşeleri); şekli className ile ez (avatar=rounded-full). animated=false statik placeholder; label region'ı role=status aria-busy yapar. Perceived performance'ı artırır."
      >
        <Preview
          title="Skeleton — şekil · animated"
          description="Boyut/şekil className ile gelen içeriği taklit eder (layout stability). animated=false statik placeholder verir; aksi takdirde pulse (reduced-motion'da otomatik kapanır)."
        >
          <div className="max-w-form gap-sm grid">
            <div className="gap-sm flex items-center">
              <Skeleton className="size-icon-xl rounded-full" />
              <div className="gap-3xs flex flex-col">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-24 w-full" />
            <div className="gap-3xs flex flex-col">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <div className="border-border mt-sm gap-3xs pt-sm grid border-t">
              <span className="text-2xs text-muted-foreground font-mono">
                animated=false (statik)
              </span>
              <Skeleton animated={false} className="h-3 w-full" />
              <Skeleton animated={false} className="h-3 w-2/3" />
            </div>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="CountBadge"
        description="Kompakt solid sayısal sayaç pili (okunmamış / bekleyen / sekme sayısı). Tek hane daire, çok hane pill; tabular-nums. tone solid dolgu; animate + key={String(value)} ile değişimde zoom-pop. NotificationBell ve Tabs bunu kullanır."
      >
        <Playground
          title="CountBadge — tone · animate"
          description="animate açıkken her render'da zoom-pop tekrar oynar (gerçek kullanımda key={String(value)} ile değişen sayıya bağlanır). Tek/çok hane daire↔pill geçişini görmek için metni değiştir."
          controls={{
            tone: control.select(TONE_KEYS, 'primary'),
            animate: control.bool(false, 'animate'),
            value: control.text('9+', 'value', 'Sayı'),
          }}
          render={(v) => (
            <CountBadge key={v.animate ? v.value : undefined} tone={v.tone} animate={v.animate}>
              {v.value}
            </CountBadge>
          )}
        />
      </ShowcaseSection>
    </>
  );
}

function AlertDismissDemo({ dismissLabel }: { dismissLabel: string }): React.ReactElement {
  const [alerts, setAlerts] = React.useState<Array<'info' | 'success' | 'warning' | 'destructive'>>(
    ['info', 'success', 'warning', 'destructive'],
  );

  if (alerts.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        Tüm uyarılar kapatıldı. Yenilemek için sayfayı reload edin.
      </span>
    );
  }

  return (
    <div className="gap-sm flex flex-col">
      {alerts.map((tone) => (
        <Alert
          key={tone}
          tone={tone}
          dismissLabel={dismissLabel}
          onDismiss={() => setAlerts((prev) => prev.filter((t) => t !== tone))}
        >
          <AlertTitle>Kapatılabilir — tone = {tone}</AlertTitle>
          <AlertDescription>
            Sağ üstte X butonu; klavye + ekran okuyucu erişilebilir.
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function ProgressLiveDemo(): React.ReactElement {
  const [progress, setProgress] = React.useState(32);

  return (
    <div className="max-w-form gap-sm grid">
      <Progress value={progress} aria-label="Trendyol siparişleri senkronize ediliyor" />
      <div className="text-2xs text-muted-foreground flex items-center justify-between">
        <span>Trendyol siparişleri senkronize ediliyor</span>
        <span className="font-mono tabular-nums">%{progress}</span>
      </div>
      <div className="gap-xs flex">
        <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
          -10
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setProgress((p) => Math.min(100, p + 10))}
        >
          +10
        </Button>
      </div>
    </div>
  );
}
