import { MoneyInput, Label } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-2xs max-w-input-narrow flex w-full flex-col">
    <Label htmlFor="cost">Ürün maliyeti</Label>
    <MoneyInput id="cost" placeholder="0,00" />
  </div>
);
