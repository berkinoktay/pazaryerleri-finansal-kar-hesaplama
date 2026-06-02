import { Calculator01Icon, ChartLineData01Icon, ShoppingBag01Icon } from 'hugeicons-react';
import * as React from 'react';

import type { NavItemBadge } from '@/components/layout/nav-config';
import { NavGroup } from '@/components/patterns/nav-group';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';

const SUB_LINK_CLASS = 'text-muted-foreground hover:text-foreground px-xs py-3xs text-xs';

interface NavGroupRow {
  key: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  isActive?: boolean;
  defaultExpanded?: boolean;
  badge?: NavItemBadge;
  /** Sub-route labels — rendered as plain anchors in the showcase frame. */
  children: readonly string[];
}

/**
 * One row per badge/state variant so the demo covers the FULL prop surface
 * NavGroup exposes — every `NavItemBadge.variant` (count / new / beta) plus
 * the `isActive` branch-active styling. The earlier showcase only rendered
 * `beta` and never set `isActive`, so the count badge, the new badge, and the
 * active parent row (brand text/icon, no left guide line) went undocumented.
 * Badge tone is derived inside NavGroup via `NAV_BADGE_TONE`, so passing the
 * `variant` is enough — the showcase doesn't hand-pick colors.
 */
const NAV_GROUP_ROWS: readonly NavGroupRow[] = [
  {
    key: 'profitability',
    label: 'Karlılık Analizi',
    icon: <ChartLineData01Icon />,
    href: '#karlilik',
    isActive: true,
    defaultExpanded: true,
    badge: { variant: 'beta', label: 'Beta' },
    children: ['Sipariş Karlılığı', 'Ürün Karlılığı', 'Mağaza Karşılaştırması'],
  },
  {
    key: 'orders',
    label: 'Siparişler',
    icon: <ShoppingBag01Icon />,
    href: '#siparisler',
    badge: { variant: 'count', label: '12' },
    children: ['Bekleyen', 'Kargoda', 'İade'],
  },
  {
    key: 'tools',
    label: 'Maliyet & Araçlar',
    icon: <Calculator01Icon />,
    href: '#maliyet',
    badge: { variant: 'new', label: 'Yeni' },
    children: ['Komisyon Hesaplama', 'Kargo Tarifesi'],
  },
];

/**
 * Mirrors how NavGroup renders inside the production AppShell sidebar:
 *   - Wrapped in `Sidebar` with collapsible="none" so the showcase
 *     doesn't try to read viewport / mobile state.
 *   - Icons sourced from `hugeicons-react` to match the real
 *     `NAV_GROUPS` config (`ChartLineData01Icon` for Karlılık,
 *     `Calculator01Icon` for Maliyet & Araçlar) — same imports the
 *     AppShell uses, same visual weight.
 *   - Sub-items rendered as plain anchors here (the showcase doesn't
 *     wire next-intl Link's locale routing). In production they'd be
 *     `<Link>` from `@/i18n/navigation`.
 */
export function NavGroupShowcase(): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="none" className="border-border bg-card max-w-sheet rounded-md border">
        <SidebarContent>
          <SidebarMenu className="p-md gap-3xs">
            {NAV_GROUP_ROWS.map((row) => (
              <SidebarMenuItem key={row.key}>
                <NavGroup
                  label={row.label}
                  icon={row.icon}
                  href={row.href}
                  isActive={row.isActive}
                  defaultExpanded={row.defaultExpanded}
                  badge={row.badge}
                >
                  {row.children.map((child) => (
                    <a key={child} className={SUB_LINK_CLASS} href="#">
                      {child}
                    </a>
                  ))}
                </NavGroup>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
