import { Switch } from '@pazarsync/web';

export const States = () => (
  <div className="gap-sm max-w-input flex w-full flex-col text-sm">
    <label className="flex items-center justify-between">
      <span>Otomatik senkronizasyon</span>
      <Switch defaultChecked />
    </label>
    <label className="flex items-center justify-between">
      <span>Düşük stok uyarısı</span>
      <Switch />
    </label>
    <label className="text-muted-foreground flex items-center justify-between">
      <span>Haftalık rapor (kilitli)</span>
      <Switch disabled defaultChecked />
    </label>
  </div>
);
