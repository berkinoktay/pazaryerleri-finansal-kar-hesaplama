import { DonutChart } from '@pazarsync/web';

const EXPENSE = [
  { label: 'Komisyon', value: 2930 },
  { label: 'Kargo', value: 1180 },
  { label: 'Reklam', value: 640 },
  { label: 'Hizmet Bedeli', value: 420 },
  { label: 'İade', value: 310 },
];

export const Expenses = () => (
  <div className="h-72 w-full">
    <DonutChart data={EXPENSE} format="currency" centerLabel="Toplam Gider" />
  </div>
);
