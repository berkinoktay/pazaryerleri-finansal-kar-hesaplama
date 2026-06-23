import { Input, Search01Icon } from '@pazarsync/web';

export const Sizes = () => (
  <div className="gap-sm max-w-input flex w-full flex-col">
    <Input size="sm" placeholder="Küçük alan" />
    <Input size="md" placeholder="Orta alan" />
    <Input size="lg" placeholder="Büyük alan" />
  </div>
);

export const WithLeadingIcon = () => (
  <div className="max-w-input w-full">
    <Input leadingIcon={<Search01Icon />} placeholder="Ürün ya da barkod ara…" />
  </div>
);

export const States = () => (
  <div className="gap-sm max-w-input flex w-full flex-col">
    <Input defaultValue="Trendyol Ana Mağaza" />
    <Input invalid defaultValue="Geçersiz barkod" />
    <Input disabled placeholder="Devre dışı" />
  </div>
);
