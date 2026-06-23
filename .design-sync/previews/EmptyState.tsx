import { Button, EmptyState, InboxIcon, PackageIcon } from '@pazarsync/web';

export const FirstRun = () => (
  <EmptyState
    icon={PackageIcon}
    title="Henüz ürün yok"
    description="Trendyol mağazanızı bağlayın; ürünleriniz otomatik olarak senkronize edilsin."
    action={<Button>Mağaza Bağla</Button>}
  />
);

export const NoResults = () => (
  <EmptyState
    icon={InboxIcon}
    title="Sonuç bulunamadı"
    description="Seçtiğiniz filtrelerle eşleşen sipariş yok."
    action={<Button variant="outline">Filtreleri Temizle</Button>}
  />
);

export const ErrorState = () => (
  <EmptyState
    iconTone="destructive"
    icon={InboxIcon}
    title="Veriler yüklenemedi"
    description="Bağlantı sırasında bir hata oluştu. Lütfen tekrar deneyin."
    action={<Button variant="outline">Tekrar Dene</Button>}
  />
);
