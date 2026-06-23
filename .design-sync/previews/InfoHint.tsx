import { InfoHint } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-xs flex items-center">
    <span className="text-sm font-medium">Net Kâr</span>
    <InfoHint label="Net kâr nasıl hesaplanır?">
      Komisyon, KDV, kargo ve stopaj düşüldükten sonra elinizde kalan tutar.
    </InfoHint>
  </div>
);
