import { FilterTabs } from '@pazarsync/web';

const OPTIONS = [
  { value: 'all', label: 'Tümü', count: 1284 },
  { value: 'delivered', label: 'Teslim Edildi', count: 1102 },
  { value: 'shipped', label: 'Kargoda', count: 96 },
  { value: 'cancelled', label: 'İptal', count: 86 },
];

export const ByStatus = () => <FilterTabs value="all" options={OPTIONS} onValueChange={() => {}} />;
