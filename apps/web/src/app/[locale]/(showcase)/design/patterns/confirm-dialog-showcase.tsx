'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Button } from '@/components/ui/button';

export function ConfirmDialogShowcase(): React.ReactElement {
  const [controlledOpen, setControlledOpen] = React.useState(false);
  const [asyncOpen, setAsyncOpen] = React.useState(false);
  const [confirmedAction, setConfirmedAction] = React.useState<string | null>(null);

  const simulateAsync = React.useCallback(async (label: string) => {
    // Synthetic delay so the spinner is visible in the showcase.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setConfirmedAction(label);
  }, []);

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Trigger-based — destructive (default)
        </span>
        <ConfirmDialog
          trigger={<Button variant="destructive">Mağazayı sil</Button>}
          title="Trendyol Acme TR mağazasını sil?"
          description="Bu mağaza ve son 90 günlük sipariş geçmişi geri alınamaz şekilde silinecek. Tarihsel raporlardaki referansları koparır."
          confirmLabel="Mağazayı sil"
          onConfirm={() => simulateAsync('Mağazayı sil')}
        />
        <span className="text-2xs text-muted-foreground">
          Tetikleyici slot ile dialog kendi state&apos;ini yönetir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Controlled — caller open state
        </span>
        <Button variant="outline" onClick={() => setControlledOpen(true)}>
          Komisyon profilini sil…
        </Button>
        <ConfirmDialog
          open={controlledOpen}
          onOpenChange={setControlledOpen}
          title="Komisyon profilini sil?"
          description="Bu profile bağlı 14 ürün varsayılan kategori komisyonuna geri döner."
          confirmLabel="Profili sil"
          onConfirm={() => simulateAsync('Komisyon profili silindi')}
        />
        <span className="text-2xs text-muted-foreground">
          open + onOpenChange caller&apos;ın elinde — URL state ile birleştirilebilir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Non-destructive (tone=&quot;default&quot;)
        </span>
        <ConfirmDialog
          trigger={<Button variant="default">Ekibe davet gönder</Button>}
          tone="default"
          title="Davet gönderilecek e-postayı onayla"
          description="ahmet@acme.tr adresine 7 gün geçerli bir davet linki gönderilecek."
          confirmLabel="Daveti gönder"
          cancelLabel="Vazgeç"
          onConfirm={() => simulateAsync('Davet gönderildi')}
        />
        <span className="text-2xs text-muted-foreground">
          Geri alınabilir aksiyon için default tone — buton primary, kırmızı değil.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Async + spinner (1.2s gecikme)
        </span>
        <Button variant="outline" onClick={() => setAsyncOpen(true)}>
          Mutabakatı kapat…
        </Button>
        <ConfirmDialog
          open={asyncOpen}
          onOpenChange={setAsyncOpen}
          title="Nisan 2026 mutabakatını kapat?"
          description="Tüm sipariş hakediş kayıtları finalize edilir; sonradan satır eklenemez."
          confirmLabel="Mutabakatı kapat"
          onConfirm={() => simulateAsync('Mutabakat kapatıldı')}
        />
        <span className="text-2xs text-muted-foreground">
          Confirm butonu loading sırasında spinner ile değişir; iki buton da disabled.
        </span>
      </div>

      {confirmedAction !== null ? (
        <div className="border-success/20 bg-success-surface text-success p-sm rounded-md text-sm sm:col-span-2">
          Son onaylanan: <strong>{confirmedAction}</strong>
          <button
            type="button"
            onClick={() => setConfirmedAction(null)}
            className="text-2xs ml-sm underline-offset-4 hover:underline"
          >
            sıfırla
          </button>
        </div>
      ) : null}
    </div>
  );
}
