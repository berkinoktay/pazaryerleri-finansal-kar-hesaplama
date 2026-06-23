import { FilterChipGroup } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <FilterChipGroup
      chips={[
        { id: 'platform', label: 'Trendyol', onRemove: () => {} },
        { id: 'status', label: 'Teslim Edildi', onRemove: () => {} },
        { id: 'date', label: 'Son 30 gün', onRemove: () => {} },
      ]}
      onClearAll={() => {}}
    />
  </div>
);
