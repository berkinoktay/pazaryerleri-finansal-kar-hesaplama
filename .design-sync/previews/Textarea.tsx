import { Textarea, Label } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-2xs max-w-form flex w-full flex-col">
    <Label htmlFor="note">Sipariş notu</Label>
    <Textarea
      id="note"
      rows={4}
      placeholder="Kargoya verirken dikkat edilmesi gereken notlar…"
      defaultValue="Müşteri hafta içi 09:00–18:00 arası teslimat istiyor."
    />
  </div>
);
