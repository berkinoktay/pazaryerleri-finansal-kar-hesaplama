import { RadioGroup, RadioGroupItem, Label } from '@pazarsync/web';

export const Default = () => (
  <RadioGroup defaultValue="aylik" className="gap-sm">
    <div className="gap-xs flex items-center">
      <RadioGroupItem value="aylik" id="r-aylik" />
      <Label htmlFor="r-aylik">Aylık özet</Label>
    </div>
    <div className="gap-xs flex items-center">
      <RadioGroupItem value="haftalik" id="r-haftalik" />
      <Label htmlFor="r-haftalik">Haftalık özet</Label>
    </div>
    <div className="gap-xs flex items-center">
      <RadioGroupItem value="gunluk" id="r-gunluk" />
      <Label htmlFor="r-gunluk">Günlük özet</Label>
    </div>
  </RadioGroup>
);
