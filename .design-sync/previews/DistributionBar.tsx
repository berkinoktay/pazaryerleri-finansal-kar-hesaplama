import { DistributionBar, Currency } from '@pazarsync/web';

export const Composition = () => (
  <div className="max-w-modal w-full">
    <DistributionBar
      showLegend
      segments={[
        {
          label: 'Net Kâr',
          value: <Currency value={142.5} />,
          percent: 58,
          color: 'var(--chart-1)',
        },
        {
          label: 'Komisyon',
          value: <Currency value={33.6} />,
          percent: 22,
          color: 'var(--chart-2)',
        },
        { label: 'Kargo', value: <Currency value={23.8} />, percent: 14, color: 'var(--chart-3)' },
        { label: 'KDV', value: <Currency value={9.6} />, percent: 6, color: 'var(--chart-4)' },
      ]}
    />
  </div>
);
