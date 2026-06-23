import { PromotionIndicator } from '@pazarsync/web';

export const Default = () => (
  <div className="gap-md flex items-center">
    <span className="text-sm tabular-nums">11321228951</span>
    <PromotionIndicator
      promotions={[
        { displayName: 'Sepette %10 İndirim', amountGross: '20.00' },
        { displayName: 'Kargo Bedava', amountGross: '34.99' },
      ]}
    />
  </div>
);
