import { BarChart } from '@pazarsync/web';

const DAILY = [
  { day: 'Pzt', net: 420 },
  { day: 'Sal', net: -120 },
  { day: 'Çar', net: 260 },
  { day: 'Per', net: 540 },
  { day: 'Cum', net: 680 },
  { day: 'Cmt', net: -80 },
  { day: 'Paz', net: 510 },
];

export const DailyNet = () => (
  <div className="h-72 w-full">
    <BarChart
      data={DAILY}
      xKey="day"
      series={{ key: 'net', label: 'Günlük net kâr', format: 'currency' }}
      colorMode="semantic"
    />
  </div>
);
