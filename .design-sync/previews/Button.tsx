import { Button, RefreshIcon, Tick02Icon, Delete02Icon } from '@pazarsync/web';

export const Variants = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <Button>Kaydet</Button>
    <Button variant="secondary">İkincil</Button>
    <Button variant="outline">Dışa Aktar</Button>
    <Button variant="ghost">Vazgeç</Button>
    <Button variant="link">Detaylar</Button>
    <Button variant="destructive">Sil</Button>
    <Button variant="success">Onayla</Button>
    <Button variant="warning">Uyar</Button>
  </div>
);

export const Sizes = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <Button size="sm">Küçük</Button>
    <Button size="md">Orta</Button>
    <Button size="lg">Büyük</Button>
  </div>
);

export const WithIcons = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <Button leadingIcon={<RefreshIcon />}>Senkronize Et</Button>
    <Button variant="success" leadingIcon={<Tick02Icon />}>
      Maliyeti Onayla
    </Button>
    <Button variant="destructive" leadingIcon={<Delete02Icon />}>
      Mağazayı Sil
    </Button>
  </div>
);

export const States = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <Button loading loadingText="Kaydediliyor…">
      Kaydet
    </Button>
    <Button disabled>Devre Dışı</Button>
    <Button variant="outline" disabled>
      Devre Dışı
    </Button>
  </div>
);
