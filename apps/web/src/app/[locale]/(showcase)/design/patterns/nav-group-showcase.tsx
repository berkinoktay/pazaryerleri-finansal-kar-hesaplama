import { Calculator01Icon, ChartLineData01Icon } from 'hugeicons-react';

import { NavGroup } from '@/components/patterns/nav-group';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';

/**
 * Mirrors how NavGroup renders inside the production AppShell sidebar:
 *   - Wrapped in `Sidebar` with collapsible="none" so the showcase
 *     doesn't try to read viewport / mobile state.
 *   - Icons sourced from `hugeicons-react` to match the real
 *     `MAIN_NAV_ITEMS` (`ChartLineData01Icon` for Karlılık,
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
            <SidebarMenuItem>
              <NavGroup
                label="Karlılık Analizi"
                icon={<ChartLineData01Icon />}
                badge={{ variant: 'beta', label: 'Beta' }}
                href="#karlilik"
                defaultExpanded
              >
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Sipariş Karlılığı
                </a>
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Ürün Karlılığı
                </a>
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Mağaza Karşılaştırması
                </a>
              </NavGroup>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <NavGroup label="Maliyet & Araçlar" icon={<Calculator01Icon />} href="#maliyet">
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Komisyon Hesaplama
                </a>
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Kargo Tarifesi
                </a>
              </NavGroup>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
