import { Checkbox } from '@pazarsync/web';

export const States = () => (
  <div className="gap-sm flex flex-col text-sm">
    <label className="gap-xs flex items-center">
      <Checkbox defaultChecked /> <span>Otomatik senkronizasyon</span>
    </label>
    <label className="gap-xs flex items-center">
      <Checkbox /> <span>E-posta bildirimleri</span>
    </label>
    <label className="gap-xs text-muted-foreground flex items-center">
      <Checkbox disabled defaultChecked /> <span>Premium (kilitli)</span>
    </label>
    <label className="gap-xs flex items-center">
      <Checkbox invalid /> <span>Koşulları kabul ediyorum</span>
    </label>
  </div>
);
