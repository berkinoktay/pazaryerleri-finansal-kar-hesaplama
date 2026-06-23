import { Label, Input } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-2xs max-w-input flex w-full flex-col">
    <Label htmlFor="store-name">Mağaza adı</Label>
    <Input id="store-name" placeholder="Trendyol — Ana Mağaza" />
  </div>
);
