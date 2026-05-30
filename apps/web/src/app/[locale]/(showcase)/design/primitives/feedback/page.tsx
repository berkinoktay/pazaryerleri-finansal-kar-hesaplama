'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusDot } from '@/components/ui/status-dot';

export default function FeedbackPrimitivePage(): React.ReactElement {
  const t = useTranslations('common');
  const [progress, setProgress] = React.useState(32);

  return (
    <>
      <PageHeader
        title="Geri bildirim"
        intent="Alert, Toast, Progress, Skeleton — kullanıcıya ne olduğunu anlatan her şey."
      />
      <PrimitiveNav />

      <Preview
        title="Alert — tone-based default icon"
        description="Icon prop verilmezse tone'a göre otomatik (info/neutral → info, success → check, warning/destructive → alert). Yan-şerit border yasak."
      >
        <div className="gap-sm flex flex-col">
          <Alert tone="info">
            <AlertDescription>
              Nisan 2026 hakediş raporu hazır. 3 mağazada mutabakat farkı tespit edildi.
            </AlertDescription>
          </Alert>
          <Alert tone="success">
            <AlertTitle>Senkronizasyon tamamlandı</AlertTitle>
            <AlertDescription>
              142 yeni sipariş çekildi. Karlılık yeniden hesaplandı.
            </AlertDescription>
          </Alert>
          <Alert tone="warning">
            <AlertTitle>3 ürünün maliyet bilgisi eksik</AlertTitle>
            <AlertDescription>
              Bu ürünler karlılık raporuna dahil edilmiyor. Maliyetler eklenmeden net kar eksik
              kalır.
            </AlertDescription>
          </Alert>
          <Alert tone="destructive">
            <AlertTitle>Hepsiburada API bağlantısı başarısız</AlertTitle>
            <AlertDescription>
              401 Unauthorized. API bilgilerini ayarlar sayfasında güncelle.
            </AlertDescription>
          </Alert>
        </div>
      </Preview>

      <Preview
        title="Alert — onDismiss"
        description="onDismiss prop, aria-label i18n'den, 44px touch target (pointer-coarse:), full-border + tint (yan-şerit YASAK)."
      >
        <AlertDismissDemo dismissLabel={t('dismiss')} />
      </Preview>

      <Preview
        title="Alert — icon=null (opt-out)"
        description="Icon gerekmediğinde prop null geçilir, default bastırılır."
      >
        <Alert tone="neutral" icon={null}>
          <AlertDescription>
            İkon istemediğin durumlar için: opt-out ile metin tam genişlikte akar.
          </AlertDescription>
        </Alert>
      </Preview>

      <Preview
        title="Alert — hasBorder + action"
        description="Varsayılan kenarlıksız (sakin yüzen bilgi). hasBorder YALNIZ warning/destructive'te ton-kenarlık firmleştirir (yüksek-riskli/geri-dönüşsüz uyarılar için). action slot'u CTA Button'ı bileşen içinde tutar — focus + layout primitive'de."
      >
        <div className="gap-sm flex flex-col">
          <Alert tone="warning" hasBorder>
            <AlertTitle>3 ürünün maliyeti eksik</AlertTitle>
            <AlertDescription>Bu ürünler kâr raporuna dahil edilmiyor.</AlertDescription>
          </Alert>
          <Alert
            tone="destructive"
            hasBorder
            action={{ label: 'Ayarlara git', onClick: () => undefined }}
          >
            <AlertTitle>Hepsiburada API bağlantısı başarısız</AlertTitle>
            <AlertDescription>401 Unauthorized — API bilgilerini güncelle.</AlertDescription>
          </Alert>
        </div>
      </Preview>

      <Preview
        title="Toast (Sonner)"
        description="Kısa, kendiliğinden kapanan bildirimler. Tona göre tinted — success toast = success Alert ile birebir (bg-success-surface + text-success). .error() → destructive; nötr toast(): bg-card + border. Optimistic update sonrası onay + undo için."
      >
        <div className="gap-xs flex flex-wrap">
          <Button variant="outline" onClick={() => toast('Standart bildirim')}>
            Info
          </Button>
          <Button variant="outline" onClick={() => toast.success('Senkronizasyon başlatıldı')}>
            Success
          </Button>
          <Button variant="outline" onClick={() => toast.warning('3 satır eksik veri')}>
            Warning
          </Button>
          <Button variant="outline" onClick={() => toast.error('Senkronizasyon başarısız')}>
            Error
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast('Ürün maliyeti güncellendi', {
                action: {
                  label: 'Geri al',
                  onClick: () => toast.info('Geri alındı'),
                },
              })
            }
          >
            With action
          </Button>
        </div>
      </Preview>

      <Preview
        title="Progress — determinate · indeterminate · tone · size"
        description="value bilinince determinate (220ms ease-out-quart geçiş); value yok = indeterminate sweep (bilinmeyen süre, reduced-motion'da statik dolu). radius varsayılan md (form chrome ailesi). tone eşik sinyali (100%=success, eşik üstü=warning); size bar yüksekliği."
      >
        <div className="max-w-form gap-sm grid">
          <Progress value={progress} />
          <div className="text-2xs text-muted-foreground flex items-center justify-between">
            <span>Trendyol siparişleri senkronize ediliyor</span>
            <span className="font-mono tabular-nums">%{progress}</span>
          </div>
          <div className="gap-xs flex">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setProgress((p) => Math.max(0, p - 10))}
            >
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
          <div className="border-border mt-sm gap-sm pt-sm grid border-t">
            <span className="text-2xs text-muted-foreground font-mono">
              indeterminate (value yok)
            </span>
            <Progress aria-label="Yükleniyor" />
            <span className="text-2xs text-muted-foreground font-mono">
              tone=success @100% · sm · lg+warning
            </span>
            <Progress value={100} tone="success" />
            <Progress value={60} size="sm" />
            <Progress value={60} size="lg" tone="warning" />
          </div>
        </div>
      </Preview>

      <Preview
        title="Spinner — size · tone"
        description="CSS dönen yay. Varsayılan currentColor miras alır (Button/Select loading'de 16px değişmeden oturur). size sm(12)/md(16)/lg(20); tone bağımsız durum göstergesi için (async başarı = success spinner). prefers-reduced-motion global olarak dönüşü durdurur (fonksiyonel sürekli motion)."
      >
        <div className="gap-lg flex flex-wrap items-center">
          <div className="gap-md flex items-center">
            <Spinner size="sm" label="Yükleniyor" />
            <Spinner size="md" label="Yükleniyor" />
            <Spinner size="lg" label="Yükleniyor" />
          </div>
          <div className="gap-md flex items-center">
            <Spinner tone="primary" label="Yükleniyor" />
            <Spinner tone="success" label="Yükleniyor" />
            <Spinner tone="warning" label="Yükleniyor" />
            <Spinner tone="destructive" label="Yükleniyor" />
          </div>
          <Button loading loadingText="Kaydediliyor…">
            Kaydet
          </Button>
        </div>
      </Preview>

      <Preview
        title="StatusDot — size · animatePulse · label"
        description="Renkli nokta + opsiyonel inline label (label slot'u → text erişilebilir ad, nokta dekoratif). sm (6px) / md (8px, default) / lg (12px). animatePulse aktif-senkron 'alive' göstergesi (org-switcher artık bunu kullanıyor). Renk asla tek sinyal değil — yanında daima etiket/ikon."
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
          <div className="gap-md pt-md flex flex-wrap items-center">
            <span className="text-2xs text-muted-foreground font-mono">sm</span>
            <StatusDot tone="success" size="sm" />
            <StatusDot tone="warning" size="sm" />
            <span className="text-2xs text-muted-foreground font-mono">md</span>
            <StatusDot tone="success" />
            <StatusDot tone="warning" />
            <span className="text-2xs text-muted-foreground font-mono">lg</span>
            <StatusDot tone="success" size="lg" />
            <StatusDot tone="warning" size="lg" />
          </div>
          <div className="gap-md flex flex-wrap items-center">
            <span className="text-2xs text-muted-foreground font-mono">animatePulse</span>
            <StatusDot tone="success" animatePulse />
            <span className="text-2xs text-muted-foreground font-mono">label slot</span>
            <StatusDot tone="success" label={<span className="text-sm">Senkronize</span>} />
            <StatusDot tone="destructive" label={<span className="text-sm">Başarısız</span>} />
          </div>
        </div>
      </Preview>

      <Preview
        title="Skeleton — radius sm · animated · label"
        description="İlk yüklemede spinner yerine içerik iskeleti. radius varsayılan sm (input/text-line köşeleri); şekli className ile ez (avatar=rounded-full). animated=false statik placeholder; label region'ı role=status aria-busy yapar. Perceived performance'ı artırır."
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
