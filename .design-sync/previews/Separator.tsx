import { Separator } from '@pazarsync/web';

export const Horizontal = () => (
  <div className="max-w-input w-full text-sm">
    <p>Genel ayarlar</p>
    <Separator className="my-sm" />
    <p>Senkronizasyon</p>
  </div>
);

export const Vertical = () => (
  <div className="gap-sm flex h-6 items-center text-sm">
    <span>Trendyol</span>
    <Separator orientation="vertical" />
    <span>Hepsiburada</span>
    <Separator orientation="vertical" />
    <span>Tümü</span>
  </div>
);
