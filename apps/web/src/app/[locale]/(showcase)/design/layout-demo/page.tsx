'use client';

import { useQueryClient } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import * as React from 'react';
import { toast } from 'sonner';

import { AppShell } from '@/components/layout/app-shell';
import { Currency } from '@/components/patterns/currency';
import { type Organization, type Store } from '@/components/patterns/org-store-switcher';
import { PageHeader } from '@/components/patterns/page-header';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { buildMockOrders } from '@/components/showcase/showcase-mocks';
import { SyncControlDemo } from '@/components/showcase/sync-control-demo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { QuickAccessPanel } from '@/features/dashboard/components/quick-access-panel';
import { useSwitcherPreviewStores } from '@/features/stores/hooks/use-switcher-preview-stores';
import { storeKeys } from '@/features/stores/query-keys';

const recentOrders = buildMockOrders(8);
const MOCK_REVENUE = new Decimal('284390.45');
const MOCK_PROFIT = new Decimal('48120.80');

// Canonical demo of the new tek-sidebar AppShell.  Two orgs are
// deliberate so OrgStoreSwitcher's multi-org behavior (search, role
// badges, deterministic per-org avatar palette) renders meaningfully
// when designers open this page.
const MOCK_ORGS: Organization[] = [
  {
    id: 'org-demo',
    name: 'Demo Organizasyon',
    role: 'OWNER',
  },
  {
    id: 'org-secondary',
    name: 'İkinci Şirket A.Ş.',
    role: 'ADMIN',
  },
];

const MOCK_QUICK_ACCESS = [
  {
    key: 'pendingOrders' as const,
    href: '/orders?status=pending',
    count: 5,
    tone: 'warning' as const,
  },
  {
    key: 'noCostProducts' as const,
    href: '/products?filter=no-cost',
    count: 12,
    tone: 'warning' as const,
  },
  {
    key: 'returnReviews' as const,
    href: '/orders?status=returned',
    count: 3,
    tone: 'warning' as const,
  },
];

const MOCK_STORES: Store[] = [
  {
    id: 'store-ty-main',
    name: 'Ana Mağaza',
    platform: 'TRENDYOL',
  },
  {
    id: 'store-ty-outlet',
    name: 'Outlet',
    platform: 'TRENDYOL',
  },
  {
    id: 'store-hb-main',
    name: 'Hepsiburada Mağazası',
    platform: 'HEPSIBURADA',
  },
];

export default function LayoutDemoPage(): React.ReactElement {
  const [activeStoreId, setActiveStoreId] = React.useState(MOCK_STORES[0]!.id);
  const activeStore = MOCK_STORES.find((s) => s.id === activeStoreId) ?? MOCK_STORES[0]!;
  const queryClient = useQueryClient();

  // One-time: seed the secondary mock org's store list so previewing it in the
  // switcher resolves from cache — this demo has no backend for org-secondary.
  // Pin stale/gc to Infinity so a later preview never triggers a live fetch.
  React.useEffect(() => {
    const secondaryOrgId = MOCK_ORGS[1]!.id;
    queryClient.setQueryDefaults(storeKeys.list(secondaryOrgId), {
      staleTime: Infinity,
      gcTime: Infinity,
    });
    queryClient.setQueryData(storeKeys.list(secondaryOrgId), []);
  }, [queryClient]);

  return (
    <div className="h-shell-demo border-border-strong overflow-hidden rounded-xl border shadow-lg">
      <AppShell
        orgs={MOCK_ORGS}
        stores={MOCK_STORES}
        activeOrgId={MOCK_ORGS[0]!.id}
        activeStoreId={activeStoreId}
        onSelectOrg={() => undefined}
        onSelectStore={setActiveStoreId}
        onSelectScope={(_orgId, storeId) => setActiveStoreId(storeId)}
        onAddStore={() => toast.info('Mağaza bağla akışı burada açılır')}
        usePreviewStores={useSwitcherPreviewStores}
      >
        <PageHeader
          title={activeStore.name}
          intent={`Nisan 2026 dönemi · ${activeStore.platform === 'TRENDYOL' ? 'Trendyol' : 'Hepsiburada'} · son 30 günün özeti`}
          actions={
            <>
              <SyncControlDemo state="fresh" />
              <Button variant="outline" size="sm">
                Rapor al
              </Button>
            </>
          }
        />

        <QuickAccessPanel items={MOCK_QUICK_ACCESS} />

        <StatGroup>
          <StatCard
            label="Ciro"
            value={<Currency value={MOCK_REVENUE} />}
            delta={{ percent: 12.4, goodDirection: 'up' }}
            context="Nisan 1-17 · Dün: ₺24.820"
            className="sm:col-span-2"
          />
          <StatCard
            label="Net kar"
            value={<Currency value={MOCK_PROFIT} />}
            delta={{ percent: 8.1, goodDirection: 'up' }}
            context="Marj %16.9"
          />
          <StatCard
            label="Sipariş"
            value={(1472).toLocaleString('tr-TR')}
            delta={{ percent: -3.2, goodDirection: 'up' }}
            context="Nisan 1-17"
          />
          <StatCard
            label="İade"
            value={38}
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
