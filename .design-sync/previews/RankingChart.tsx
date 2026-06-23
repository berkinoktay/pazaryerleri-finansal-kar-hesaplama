import { RankingChart } from '@pazarsync/web';

const TOP = [
  { label: 'Parfüm 50ml', value: 8420 },
  { label: 'Bluetooth Kulaklık', value: 6310 },
  { label: 'Termos 750ml', value: 4980 },
  { label: 'Telefon Kılıfı', value: 3120 },
  { label: 'Powerbank 10000', value: 2240 },
];

export const TopProducts = () => (
  <div className="h-72 w-full">
    <RankingChart data={TOP} format="currency" topN={5} />
  </div>
);
