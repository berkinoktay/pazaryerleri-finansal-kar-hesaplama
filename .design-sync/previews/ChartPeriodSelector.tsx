import { ChartPeriodSelector } from '@pazarsync/web';

const OPTIONS = [
  { value: '7d', label: '7G' },
  { value: '30d', label: '30G' },
  { value: '90d', label: '90G' },
  { value: '12m', label: '12A' },
];

export const Periods = () => (
  <ChartPeriodSelector value="30d" options={OPTIONS} onValueChange={() => {}} />
);
