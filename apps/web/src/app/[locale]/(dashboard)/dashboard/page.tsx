import Decimal from 'decimal.js';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { PageHeader } from '@/components/patterns/page-header';
import { StatGroup } from '@/components/patterns/stat-group';
import { SyncBadge } from '@/components/patterns/sync-badge';

export const metadata = {
  title: 'Gösterge paneli',
};

// Mock values hoisted out of render so they don't re-construct on every pass
// and so React Compiler doesn't flag `new Decimal(...)` as an impure call in
// the render body. Real values will flow from React Query hooks.
const MOCK_REVENUE = new Decimal('284390.45');
const MOCK_PROFIT = new Decimal('48120.80');
const MOCK_LAST_SYNCED = new Date(Date.now() - 3 * 60 * 1000);

export default function DashboardPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Gösterge paneli"
        intent="Seçili mağaza ve dönem için özet finansal durum. Detay sayfaları için sol context rail'i kullan."
        meta={<SyncBadge state="fresh" lastSyncedAt={MOCK_LAST_SYNCED} source="Trendyol" />}
      />
      <StatGroup>
        <KpiTile
          label="Ciro"
          value={{ kind: 'currency', amount: MOCK_REVENUE }}
          delta={{ percent: 12.4, goodDirection: 'up' }}
          context="Nisan 1-17 · Dün: ₺24.820"
          wide
        />
        <KpiTile
          label="Net kar"
          value={{ kind: 'currency', amount: MOCK_PROFIT }}
          delta={{ percent: 8.1, goodDirection: 'up' }}
          context="Marj %16.9"
        />
        <KpiTile
          label="Sipariş"
          value={{ kind: 'count', amount: 1472 }}
          delta={{ percent: -3.2, goodDirection: 'up' }}
          context="Nisan 1-17"
        />
        <KpiTile
          label="İade"
          value={{ kind: 'count', amount: 38 }}
          delta={{ percent: -14.2, goodDirection: 'down' }}
          context="İade oranı %2.6"
        />
      </StatGroup>
    </>
  );
}
