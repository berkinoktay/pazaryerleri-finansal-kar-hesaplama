import { Combobox } from '@pazarsync/web';

const OPTIONS = [
  { value: 'trendyol', label: 'Trendyol' },
  { value: 'hepsiburada', label: 'Hepsiburada' },
  { value: 'n11', label: 'n11' },
  { value: 'amazon', label: 'Amazon TR' },
];

export const Default = () => (
  <div className="max-w-input w-full">
    <Combobox value="trendyol" options={OPTIONS} onChange={() => {}} placeholder="Pazar yeri seç" />
  </div>
);
