import { StatGroup, StatCard, Currency } from '@pazarsync/web';

export const Default = () => (
  <div className="w-full">
    <StatGroup>
      <StatCard
        label="Bu Ay Ciro"
        value={<Currency value={284390.45} />}
        delta={{ percent: 12.4, goodDirection: 'up' }}
      />
      <StatCard
        label="Net Kâr"
        value={<Currency value={68240.1} />}
        delta={{ percent: 8.1, goodDirection: 'up' }}
        emphasis
      />
      <StatCard
        label="Sipariş Sayısı"
        value="1.284"
        delta={{ percent: 3.2, goodDirection: 'up' }}
      />
    </StatGroup>
  </div>
);
