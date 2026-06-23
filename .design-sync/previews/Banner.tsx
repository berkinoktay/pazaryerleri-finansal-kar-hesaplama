import { Banner, Button } from '@pazarsync/web';

export const Tones = () => (
  <div className="gap-sm flex w-full flex-col">
    <Banner
      tone="info"
      title="Senkronizasyon sürüyor"
      description="Trendyol siparişleri güncelleniyor."
    />
    <Banner tone="success" title="Hakediş eşleşti" description="Tüm siparişler mutabakatlandı." />
    <Banner
      tone="warning"
      title="Maliyet eksik"
      description="14 ürünün maliyeti girilmemiş — kâr hesaplanamıyor."
      action={
        <Button size="sm" variant="outline">
          Düzelt
        </Button>
      }
    />
    <Banner
      tone="destructive"
      title="Senkronizasyon başarısız"
      description="Trendyol API anahtarı geçersiz görünüyor."
      onDismiss={() => {}}
      dismissLabel="Kapat"
    />
  </div>
);
