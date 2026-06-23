import { Alert, AlertTitle, AlertDescription } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <Alert>
      <AlertTitle>Hakediş mutabakatı tamamlandı</AlertTitle>
      <AlertDescription>
        Trendyol Mayıs hakediş raporu işlendi. 142 siparişin net kârı güncellendi.
      </AlertDescription>
    </Alert>
  </div>
);

export const Destructive = () => (
  <div className="max-w-modal w-full">
    <Alert variant="destructive">
      <AlertTitle>Mağaza bağlantısı koptu</AlertTitle>
      <AlertDescription>
        Trendyol API anahtarı geçersiz. Senkronizasyon durduruldu — lütfen kimlik bilgilerini
        güncelleyin.
      </AlertDescription>
    </Alert>
  </div>
);
