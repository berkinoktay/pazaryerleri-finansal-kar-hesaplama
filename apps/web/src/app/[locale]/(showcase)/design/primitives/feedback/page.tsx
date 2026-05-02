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
        title="Toast (Sonner)"
        description="Kısa, kendiliğinden kapanan bildirimler. Optimistic update sonrası onay + undo için."
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
        title="Progress"
        description="Determinate progress — senkronizasyon, dosya yükleme gibi ilerlemesi ölçülebilir işler için."
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
        </div>
      </Preview>

      <Preview
        title="StatusDot"
        description="Sadece renkli nokta — etiket istemediğinde Badge'den hafif. Tonlar Alert / Badge / TrendDelta ile aynı kelimeye sahip; sm (6px) sıkı satırlar için, md (8px) varsayılan. Renk asla tek sinyal değildir; çevresinde her zaman bir etiket / ikon olmalı."
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
          <div className="gap-md pt-md flex items-center">
            <span className="text-2xs text-muted-foreground font-mono">size = sm</span>
            <StatusDot tone="success" size="sm" />
            <StatusDot tone="warning" size="sm" />
            <StatusDot tone="destructive" size="sm" />
            <StatusDot tone="info" size="sm" />
            <span className="text-2xs text-muted-foreground font-mono">size = md (default)</span>
            <StatusDot tone="success" />
            <StatusDot tone="warning" />
            <StatusDot tone="destructive" />
            <StatusDot tone="info" />
          </div>
        </div>
      </Preview>

      <Preview
        title="Skeleton"
        description="İlk yüklemede spinner yerine içerik iskeleti göster. Perceived performance'ı artırır."
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
