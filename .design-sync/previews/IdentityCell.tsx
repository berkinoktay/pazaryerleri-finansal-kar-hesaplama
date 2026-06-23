import { IdentityCell, Badge } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-form w-full">
    <IdentityCell
      leading={
        <div className="bg-info-surface text-info flex size-9 items-center justify-center rounded-md text-sm font-semibold">
          TY
        </div>
      }
      title="Trendyol — Ana Mağaza"
      meta="Son senkron: 2 saat önce"
      trailing={<Badge tone="success">Aktif</Badge>}
    />
  </div>
);
