import { ComboChart } from '@pazarsync/web';

const DATA = [
  { month: 'Oca', ciro: 84000, marj: 18.2 },
  { month: 'Şub', ciro: 96000, marj: 21.4 },
  { month: 'Mar', ciro: 91000, marj: 19.8 },
  { month: 'Nis', ciro: 118000, marj: 22.6 },
  { month: 'May', ciro: 132000, marj: 24.1 },
  { month: 'Haz', ciro: 145000, marj: 23.5 },
];

export const RevenueMargin = () => (
  <div className="h-72 w-full">
    <ComboChart
      data={DATA}
      xKey="month"
      bars={[{ key: 'ciro', label: 'Ciro', format: 'currency' }]}
      lines={[{ key: 'marj', label: 'Marj', format: 'percent' }]}
    />
  </div>
);
