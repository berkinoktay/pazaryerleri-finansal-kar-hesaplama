'use client';

import Decimal from 'decimal.js';
import * as React from 'react';
import { toast } from 'sonner';

import { AppShell } from '@/components/layout/app-shell';
import { Currency } from '@/components/patterns/currency';
import { KpiTile } from '@/components/patterns/kpi-tile';
import { type Organization, type Store } from '@/components/patterns/org-store-switcher';
import { PageHeader } from '@/components/patterns/page-header';
import { StatGroup } from '@/components/patterns/stat-group';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { buildMockOrders } from '@/components/showcase/showcase-mocks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const recentOrders = buildMockOrders(8);
const MOCK_REVENUE = new Decimal('284390.45');
const MOCK_PROFIT = new Decimal('48120.80');
// Fixed ISO timestamp — `Date.now()` at module scope evaluates at different
// moments on server vs client in client components, producing a hydration
// mismatch when minute-precision labels straddle a minute boundary.
const MOCK_LAST_SYNCED = new Date('2026-04-20T21:00:00Z');

// T2.1 cutover left this page on minimal mocks for the new AppShell
// surface — T2.4 owns the proper refresh of this demo.
const MOCK_ORGS: Organization[] = [
  {
    id: 'org-demo',
    name: 'Demo Organizasyon',
    role: 'OWNER',
    storeCount: 3,
    lastSyncedAt: '2026-04-20T21:00:00Z',
  },
];

const MOCK_STORES: Store[] = [
  {
    id: 'store-ty-main',
    name: 'Ana Mağaza',
    platform: 'TRENDYOL',
    syncState: 'fresh',
    lastSyncedAt: '2026-04-20T21:00:00Z',
  },
  {
    id: 'store-ty-outlet',
    name: 'Outlet',
    platform: 'TRENDYOL',
    syncState: 'fresh',
    lastSyncedAt: '2026-04-20T21:00:00Z',
  },
  {
    id: 'store-hb-main',
    name: 'Hepsiburada Mağazası',
    platform: 'HEPSIBURADA',
    syncState: 'stale',
    lastSyncedAt: '2026-04-19T15:00:00Z',
  },
];

export default function LayoutDemoPage(): React.ReactElement {
  const [activeStoreId, setActiveStoreId] = React.useState(MOCK_STORES[0]!.id);
  const activeStore = MOCK_STORES.find((s) => s.id === activeStoreId) ?? MOCK_STORES[0]!;

  return (
    <div className="h-shell-demo border-border-strong overflow-hidden rounded-xl border shadow-lg">
      <AppShell
        orgs={MOCK_ORGS}
        stores={MOCK_STORES}
        activeOrgId={MOCK_ORGS[0]!.id}
        activeStoreId={activeStoreId}
        onSelectOrg={() => undefined}
        onSelectStore={setActiveStoreId}
        onAddStore={() => toast.info('Mağaza bağla akışı burada açılır')}
      >
        <PageHeader
          title={activeStore.name}
          intent={`Nisan 2026 dönemi · ${activeStore.platform === 'TRENDYOL' ? 'Trendyol' : 'Hepsiburada'} · son 30 günün özeti`}
          meta={
            <SyncBadge
              state="fresh"
              lastSyncedAt={MOCK_LAST_SYNCED}
              source={activeStore.platform === 'TRENDYOL' ? 'Trendyol' : 'Hepsiburada'}
            />
          }
          actions={
            <>
              <Button variant="outline" size="sm">
                Rapor al
              </Button>
              <Button size="sm">Senkronize et</Button>
            </>
          }
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

        <div className="gap-md grid lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardContent className="gap-md p-lg flex flex-col">
              <div className="flex items-baseline justify-between">
                <h2 className="text-md font-semibold">Son siparişler</h2>
                <a
                  href="#"
                  className="text-2xs text-primary font-medium underline-offset-4 hover:underline"
                >
                  Hepsini gör
                </a>
              </div>
              <ul className="gap-xs flex flex-col">
                {recentOrders.map((order) => (
                  <li
                    key={order.id}
                    className="border-border px-sm py-xs flex items-center justify-between rounded-md border text-sm"
                  >
                    <div className="gap-3xs flex flex-col">
                      <span className="text-foreground font-mono text-xs">{order.orderNumber}</span>
                      <span className="text-2xs text-muted-foreground">{order.customer}</span>
                    </div>
                    <Currency value={order.netProfit} emphasis />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="gap-md p-lg flex flex-col">
              <h2 className="text-md font-semibold">Hızlı aksiyonlar</h2>
              <div className="gap-xs flex flex-col">
                <Button variant="outline" className="justify-start">
                  Ürün maliyetlerini içe aktar
                </Button>
                <Button variant="outline" className="justify-start">
                  Kargo tarifesini güncelle
                </Button>
                <Button variant="outline" className="justify-start">
                  Kampanya simülasyonu oluştur
                </Button>
                <Button variant="ghost" className="justify-start">
                  Hakediş mutabakatı başlat
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </div>
  );
}
