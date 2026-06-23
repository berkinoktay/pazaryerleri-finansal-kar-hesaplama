import { StatCard, Currency } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <StatCard
      label="Net Kâr"
      value={<Currency value={68240.1} />}
      delta={{ percent: 8.1, goodDirection: 'up', period: 'geçen aya göre' }}
      emphasis
    />
  </div>
);

export const WithDrilldown = () => (
  <div className="max-w-modal w-full">
    <StatCard
      label="Bu Ay Ciro"
      value={<Currency value={284390.45} />}
      delta={{ percent: 12.4, goodDirection: 'up', period: 'geçen aya göre' }}
      href="/dashboard/ciro"
      drillLabel="Detayları gör"
    />
  </div>
);
