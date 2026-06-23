import { PercentageInput, Label } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-2xs max-w-input-narrow flex w-full flex-col">
    <Label htmlFor="commission">Komisyon oranı</Label>
    <PercentageInput id="commission" placeholder="0" />
  </div>
);
