import { StatRow, Card, Badge, Store01Icon, PackageIcon } from '@pazarsync/web';

export const InCard = () => (
  <Card className="max-w-modal w-full">
    <StatRow
      icon={<Store01Icon />}
      title="Trendyol — Ana Mağaza"
      meta="Bağlı · 2 saat önce"
      metaTone="success"
      trailing={<Badge tone="success">Aktif</Badge>}
    />
    <StatRow
      icon={<PackageIcon />}
      title="Maliyet bekleyen ürünler"
      meta="14 ürün — kâr hesaplanamıyor"
      metaTone="warning"
      trailing={<span className="text-sm tabular-nums">14</span>}
      interactive
    />
  </Card>
);
