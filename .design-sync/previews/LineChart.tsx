import { LineChart } from '@pazarsync/web';

const TREND = [
  { month: 'Oca', net: 12400 },
  { month: 'Şub', net: 15800 },
  { month: 'Mar', net: 14200 },
  { month: 'Nis', net: 19600 },
  { month: 'May', net: 22800 },
  { month: 'Haz', net: 26400 },
];

export const Revenue = () => (
  <div className="h-72 w-full">
    <LineChart
      data={TREND}
      xKey="month"
      series={{ key: 'net', label: 'Net Kâr', format: 'currency' }}
      variant="area"
      colorMode="brand"
    />
  </div>
);
