'use client';

import { PageHeader } from '@/components/patterns/page-header';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';
import { Button } from '@/components/ui/button';

import { BottomDockShowcase } from '../bottom-dock-showcase';
import { NavGroupShowcase } from '../nav-group-showcase';
import { OrgStoreSwitcherShowcase } from '../org-store-switcher-showcase';
import { ThemeToggleShowcase } from '../theme-toggle-showcase';

const MOCK_SYNC_REF = new Date('2026-04-20T21:00:00Z');
const MOCK = {
  syncMeta: new Date(MOCK_SYNC_REF.getTime() - 4 * 60 * 1000),
};

export default function ChromePatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Layout & gezinme pattern'ları"
        intent="Sayfa header'ı, sidebar bileşenleri, switcher chip'i. Uygulama-seviyesi top bar yok — her sayfa kendi PageHeader'ını taşır."
      />
      <PatternNav />

      <Preview
        title="PageHeader"
        description="Sayfa başlık + intent + meta + aksiyonlar. intent başlığı tekrarlamaz — bağlam, dönem veya scope verir. SyncBadge `meta` slot'unda; aksiyonlar `actions` slot'unda."
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

      <Preview
        title="OrgStoreSwitcher"
        description="Tek-sidebar başlığındaki birleşik org+mağaza chip'i. ⌘O hotkey'i, sync warning border'ı, daraltılmış sidebar modu, boş durum CTA'ları."
      >
        <OrgStoreSwitcherShowcase />
      </Preview>

      <Preview
        title="NavGroup"
        description="Tek-sidebar tasarımında nested feature grupları için açılır-kapanır başlık. Animasyon `grid-template-rows: 0fr → 1fr` üzerinden — height transition'ları yasak. İsteğe bağlı Yeni / Beta / count rozeti satır-içi."
      >
        <NavGroupShowcase />
      </Preview>

      <Preview
        title="SubNavList"
        description="ContextRail orta slot'u için ikincil gezinme listesi. Aktif satır `bg-accent text-primary` — IconRail nav active state'iyle eşleşir. Opsiyonel count badge tone-driven (warning / info / default)."
      >
        <SubNavListPreview />
      </Preview>

      <Preview
        title="BottomDock"
        description="Sidebar'ın altına oturan yardımcı küme. Yenilikler / Destek / Ayarlar yardımcı linkleri ve kullanıcı satırını barındırır. Yapısal olarak minimal — içeriği AppShell üzerinden enjekte edilir, pattern i18n-bağımsızdır."
      >
        <BottomDockShowcase />
      </Preview>

      <Preview
        title="ThemeToggleInline"
        description="Sidebar bottom dock için satır-içi tema anahtarı. Sun + Moon ikonları her iki render'da da DOM'da; `dark:` Tailwind varyantı görünürlüğü değiştirir. resolvedTheme yalnızca useIsMounted gate'inin arkasında okunur — SSR çıktısı ilk paint ile byte-eşit kalır."
      >
        <ThemeToggleShowcase />
      </Preview>
    </>
  );
}

/**
 * Use real `nav.*` message keys (the same ones the production AppShell
 * consumes) so the labels read as actual app navigation rather than
 * placeholder strings. Counts pulled from typical Acme A.Ş. dashboard
 * snapshot — realistic order / pending / shipped / returns split.
 */
function SubNavListPreview(): React.ReactElement {
  return (
    <div className="border-border bg-card p-sm w-rail-context rounded-md border">
      <SubNavList
        currentHref="/dashboard/orders"
        items={[
          {
            key: 'orders',
            labelKey: 'nav.orders',
            href: '/dashboard/orders',
            count: 1472,
            tone: 'default',
          },
          {
            key: 'reconciliation',
            labelKey: 'nav.reconciliation',
            href: '/dashboard/reconciliation',
            count: 5,
            tone: 'warning',
          },
          {
            key: 'products',
            labelKey: 'nav.products',
            href: '/dashboard/products',
            count: 1320,
            tone: 'default',
          },
          {
            key: 'expenses',
            labelKey: 'nav.expenses',
            href: '/dashboard/expenses',
            count: 38,
            tone: 'info',
          },
        ]}
      />
    </div>
  );
}
