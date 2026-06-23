import { Currency, StatStrip } from '@pazarsync/web';

export const KpiBand = () => (
  <StatStrip
    items={[
      {
        label: 'Ciro',
        value: <Currency value={284390.45} />,
        delta: { percent: 12.4, goodDirection: 'up', period: 'geçen aya göre' },
      },
      {
        label: 'Net Kâr',
        value: <Currency value={68240.1} />,
        delta: { percent: 8.1, goodDirection: 'up', period: 'geçen aya göre' },
      },
      {
        label: 'Sipariş',
        value: '1.284',
        delta: { percent: -3.2, goodDirection: 'up', period: 'geçen aya göre' },
      },
      {
        label: 'İade Oranı',
        value: '%4,2',
        delta: { percent: -1.1, goodDirection: 'down', period: 'geçen aya göre' },
      },
    ]}
  />
);
