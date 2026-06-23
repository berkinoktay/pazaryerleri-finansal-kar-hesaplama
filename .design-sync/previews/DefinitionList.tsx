import { DefinitionList, Currency } from '@pazarsync/web';

export const OrderFacts = () => (
  <div className="max-w-modal w-full">
    <DefinitionList
      dividers
      items={[
        { term: 'Sipariş No', description: '11321228951' },
        { term: 'Mağaza', description: 'Trendyol — Ana Mağaza' },
        { term: 'Komisyon', description: <Currency value={33.6} /> },
        { term: 'Net Kâr', description: <Currency value={142.5} emphasis /> },
      ]}
    />
  </div>
);

export const Stacked = () => (
  <div className="max-w-modal w-full">
    <DefinitionList
      layout="stacked"
      items={[
        { term: 'Kargo', description: 'Yurtiçi Kargo · 1,2 desi' },
        { term: 'Teslimat', description: '23.06.2026 · zamanında' },
      ]}
    />
  </div>
);
