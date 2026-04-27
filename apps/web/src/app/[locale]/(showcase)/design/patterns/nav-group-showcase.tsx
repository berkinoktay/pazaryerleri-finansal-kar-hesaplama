import { NavGroup } from '@/components/patterns/nav-group';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';

export function NavGroupShowcase(): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="none" className="border-border bg-card w-60 rounded-md border">
        <SidebarContent>
          <SidebarMenu className="p-md gap-3xs">
            <SidebarMenuItem>
              <NavGroup
                label="Karlılık Analizi"
                icon={<span aria-hidden>📈</span>}
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
              </NavGroup>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <NavGroup
                label="Maliyet & Araçlar"
                icon={<span aria-hidden>🛠</span>}
                href="#maliyet"
              >
                <a
                  className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs"
                  href="#"
                >
                  Komisyon Hesaplama
                </a>
              </NavGroup>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
