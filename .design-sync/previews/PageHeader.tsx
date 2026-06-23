import { PageHeader, Button } from '@pazarsync/web';

export const Default = () => (
  <div className="w-full">
    <PageHeader
      title="Siparişler"
      intent="Mağazanızdaki tüm siparişleri görüntüleyin ve sipariş bazında net kârlılığı izleyin."
      actions={<Button>Senkronize Et</Button>}
    />
  </div>
);
