'use client';

import Decimal from 'decimal.js';
import { DatabaseIcon, ShoppingBag01Icon } from 'hugeicons-react';

import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { KpiTile } from '@/components/patterns/kpi-tile';
import { PageHeader } from '@/components/patterns/page-header';
import { StatGroup } from '@/components/patterns/stat-group';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Preview } from '@/components/showcase/preview';
import { Button } from '@/components/ui/button';

import { BottomDockShowcase } from './bottom-dock-showcase';

// Hoisted mock values — stable references so React Compiler doesn't complain
// about `new Decimal(...)` / `new Date(...)` being called during render.
// Use fixed ISO timestamps for sync dates: `Date.now()` at module scope
// evaluates at different moments on server vs client in client components,
// producing hydration mismatches when the absolute-time fallback straddles
// a minute boundary. Relative labels computed after mount still read fine.
const MOCK_SYNC_REF = new Date('2026-04-20T21:00:00Z');
const MOCK = {
  revenue: new Decimal('284390.45'),
  profit: new Decimal('48120.80'),
  sampleAmount: new Decimal('1284.39'),
  emphasisAmount: new Decimal('48120.80'),
  negativeAmount: new Decimal('-248.15'),
  headerAmount: new Decimal('120.00'),
  syncFresh: new Date(MOCK_SYNC_REF.getTime() - 2 * 60 * 1000),
  syncStale: new Date(MOCK_SYNC_REF.getTime() - 45 * 60 * 1000),
  syncing: new Date(MOCK_SYNC_REF.getTime() - 30 * 1000),
  syncFailed: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 60 * 1000),
  syncMeta: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 1000),
};

export default function PatternsShowcasePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Pattern katmanı"
        intent="shadcn primitive'leri üstüne bindirilen PazarSync-özel finansal desenler. KPI, trend delta, currency, sync status gibi sıkça kullanılan yapılar."
      />

      <Preview
        title="KPI Tile + StatGroup"
        description="Değer-birinci hiyerarşi. Delta chip ikon + renk + işaret ile; renk asla tek sinyal değil."
      >
        <StatGroup>
          <KpiTile
            label="Ciro"
            value={{ kind: 'currency', amount: MOCK.revenue }}
            delta={{ percent: 12.4, goodDirection: 'up' }}
            context="Dün: ₺252.980 · Trendyol Ana Mağaza"
          />
          <KpiTile
            label="Net kar"
            value={{ kind: 'currency', amount: MOCK.profit }}
            delta={{ percent: 8.1, goodDirection: 'up' }}
            context="Marj %16.9 · Nisan 2026"
          />
          <KpiTile
            label="Sipariş"
            value={{ kind: 'count', amount: 1472 }}
            delta={{ percent: -3.2, goodDirection: 'up' }}
            context="Nisan 1-17 · Bugün: 82"
          />
          <KpiTile
            label="İade"
            value={{ kind: 'count', amount: 38 }}
            delta={{ percent: -14.2, goodDirection: 'down' }}
            context="İade oranı %2.6"
          />
        </StatGroup>
      </Preview>

      <Preview
        title="TrendDelta"
        description="Ciro için yukarı iyi; iade için aşağı iyi. `goodDirection` ile anlamsal kontrol."
      >
        <div className="gap-md flex flex-wrap">
          <TrendDelta value={12.4} goodDirection="up" />
          <TrendDelta value={-3.2} goodDirection="up" />
          <TrendDelta value={0} />
          <TrendDelta value={14.2} goodDirection="down" />
          <TrendDelta value={-6.1} goodDirection="down" />
          <TrendDelta value={25} size="md" />
        </div>
      </Preview>

      <Preview
        title="Currency"
        description="Decimal.js + Intl.NumberFormat tr-TR. Her zaman tabular-nums. Emphasis KPI hero için."
      >
        <div className="gap-sm text-muted-foreground flex flex-col font-mono text-sm">
          <div>
            <Currency value={MOCK.sampleAmount} /> (default)
          </div>
          <div>
            <Currency value={MOCK.emphasisAmount} emphasis /> (emphasis)
          </div>
          <div>
            <Currency value={0} dimWhenZero /> (zero — dimmed)
          </div>
          <div>
            <Currency value={MOCK.negativeAmount} /> (negative)
          </div>
        </div>
      </Preview>

      <Preview
        title="SyncBadge"
        description="Verinin güncelliğini tek bakışta iletir. Timezone açık (GMT+3), kaynak pazaryeri görünür."
      >
        <div className="gap-xs flex flex-col">
          <SyncBadge state="fresh" lastSyncedAt={MOCK.syncFresh} source="Trendyol" />
          <SyncBadge state="stale" lastSyncedAt={MOCK.syncStale} source="Trendyol" />
          <SyncBadge state="syncing" lastSyncedAt={MOCK.syncing} source="Trendyol" />
          <SyncBadge state="failed" lastSyncedAt={MOCK.syncFailed} source="Hepsiburada" />
        </div>
      </Preview>

      <Preview
        title="PageHeader"
        description="Sayfa başlık + intent + meta + aksiyonlar. Uygulama-seviyesi top bar yok."
      >
        <PageHeader
          title="Sipariş mutabakatı"
          intent="Nisan 2026 dönemi · Trendyol Ana Mağaza · Hakediş karşılığını sipariş bazında doğrula."
          meta={<SyncBadge state="fresh" lastSyncedAt={MOCK.syncMeta} source="Trendyol" />}
          actions={
            <>
              <Button variant="outline" size="sm">
                Dışa aktar
              </Button>
              <Button size="sm">Mutabakatı başlat</Button>
            </>
          }
        />
      </Preview>

      <Preview title="EmptyState">
        <div className="gap-lg grid sm:grid-cols-2">
          <EmptyState
            icon={ShoppingBag01Icon}
            title="Henüz sipariş yok"
            description="Mağaza bağlandıktan sonra siparişler otomatik senkronize edilir."
            action={<Button size="sm">Mağaza bağla</Button>}
          />
          <EmptyState
            icon={DatabaseIcon}
            title="Seçili döneme ait kayıt bulunamadı"
            description="Tarih aralığını genişletmeyi veya filtreleri temizlemeyi dene."
            action={
              <Button variant="outline" size="sm">
                Filtreleri temizle
              </Button>
            }
          />
        </div>
      </Preview>

      <Preview
        title="BottomDock"
        description="Tek-sidebar tasarımının altına oturan yardımcı küme. Destek / Ayarlar / Tema / Kullanıcı satırını barındırır. Yapısal olarak minimal — içeriği AppShell üzerinden enjekte edilir, pattern i18n-bağımsızdır."
      >
        <BottomDockShowcase />
      </Preview>
    </>
  );
}
