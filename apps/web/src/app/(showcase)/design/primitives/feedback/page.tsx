'use client';

import { AlertCircleIcon, CheckmarkCircle02Icon, InformationCircleIcon } from 'hugeicons-react';
import * as React from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export default function FeedbackPrimitivePage(): React.ReactElement {
  const [progress, setProgress] = React.useState(32);

  return (
    <>
      <PageHeader
        title="Geri bildirim"
        intent="Alert, Toast, Progress, Skeleton — kullanıcıya ne olduğunu anlatan her şey."
      />
      <PrimitiveNav />

      <Preview
        title="Alert"
        description="Inline uyarı. Yan-şerit border yasak — tone rengi arka plan + icon ile taşınır."
      >
        <div className="gap-sm flex flex-col">
          <Alert tone="info">
            <InformationCircleIcon />
            <AlertDescription>
              Nisan 2026 hakediş raporu hazır. 3 mağazada mutabakat farkı tespit edildi.
            </AlertDescription>
          </Alert>
          <Alert tone="success">
            <CheckmarkCircle02Icon />
            <div className="gap-3xs flex flex-col">
              <AlertTitle>Senkronizasyon tamamlandı</AlertTitle>
              <AlertDescription>
                142 yeni sipariş çekildi. Karlılık yeniden hesaplandı.
              </AlertDescription>
            </div>
          </Alert>
          <Alert tone="warning">
            <AlertCircleIcon />
            <div className="gap-3xs flex flex-col">
              <AlertTitle>3 ürünün maliyet bilgisi eksik</AlertTitle>
              <AlertDescription>
                Bu ürünler karlılık raporuna dahil edilmiyor. Maliyetler eklenmeden net kar eksik
                kalır.
              </AlertDescription>
            </div>
          </Alert>
          <Alert tone="destructive">
            <AlertCircleIcon />
            <div className="gap-3xs flex flex-col">
              <AlertTitle>Hepsiburada API bağlantısı başarısız</AlertTitle>
              <AlertDescription>
                401 Unauthorized. API bilgilerini ayarlar sayfasında güncelle.
              </AlertDescription>
            </div>
          </Alert>
        </div>
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
