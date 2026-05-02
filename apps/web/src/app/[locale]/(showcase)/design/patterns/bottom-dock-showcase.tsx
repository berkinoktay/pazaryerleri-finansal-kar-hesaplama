import {
  ChartLineData01Icon,
  DashboardSquare02Icon,
  HelpCircleIcon,
  Megaphone01Icon,
  PackageIcon,
  ReceiptDollarIcon,
  Settings02Icon,
  ShoppingBag01Icon,
  User02Icon,
} from 'hugeicons-react';

import { BottomDock } from '@/components/patterns/bottom-dock';
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';

interface MainNavRow {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
}

/**
 * Mirrors the production AppShell's primary nav (`MAIN_NAV_ITEMS`)
 * so BottomDock renders inside the same neighbourhood the user sees
 * on every dashboard page — main nav above, footer cluster below,
 * matching weight + spacing.
 */
const MAIN_NAV: MainNavRow[] = [
  { label: 'Panel', icon: DashboardSquare02Icon, isActive: true },
  { label: 'Siparişler', icon: ShoppingBag01Icon },
  { label: 'Ürünler', icon: PackageIcon },
  { label: 'Karlılık', icon: ChartLineData01Icon },
  { label: 'Giderler', icon: ReceiptDollarIcon },
];

/**
 * BottomDock in its real environment: wrapped in a non-collapsible
 * mini-`Sidebar` so it sits inside the same SidebarProvider context
 * and SidebarMenuButton geometry as the production AppShell. Auxiliary
 * row icons (Megaphone for Yenilikler, HelpCircle for Destek, Settings
 * for Ayarlar, User02 for the user identity row) are sourced from
 * `hugeicons-react` and match the icons the real app uses for the
 * same purposes — no emoji stand-ins.
 */
export function BottomDockShowcase(): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="none" className="border-border bg-card max-w-sheet rounded-md border">
        <SidebarContent>
          <SidebarMenu className="p-md gap-3xs">
            {MAIN_NAV.map((row) => (
              <SidebarMenuItem key={row.label}>
                <SidebarMenuButton tooltip={row.label} isActive={row.isActive}>
                  <row.icon />
                  <span>{row.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <BottomDock>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Yenilikler">
                <Megaphone01Icon />
                <span>Yenilikler</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Destek">
                <HelpCircleIcon />
                <span>Destek</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Ayarlar">
                <Settings02Icon />
                <span>Ayarlar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <BottomDock.Divider />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Kullanıcı menüsü" className="py-xs h-auto items-start">
                <User02Icon />
                <span className="gap-3xs flex flex-col items-start leading-tight">
                  <span className="text-foreground text-sm font-medium">Berkin Oktay</span>
                  <span className="text-muted-foreground text-2xs">Owner · Acme A.Ş.</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </BottomDock>
      </Sidebar>
    </SidebarProvider>
  );
}
