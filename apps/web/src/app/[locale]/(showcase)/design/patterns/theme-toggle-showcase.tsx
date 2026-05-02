import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';
import { Sidebar, SidebarContent, SidebarMenu, SidebarProvider } from '@/components/ui/sidebar';

/**
 * `ThemeToggleInline` composes `SidebarMenuButton`, which calls
 * `useSidebar()` — so it MUST render inside a `SidebarProvider`
 * subtree, otherwise the whole route segment's error boundary
 * catches the throw and the rest of the patterns page disappears.
 *
 * The showcase frame is a non-collapsible mini-sidebar so the
 * primitive renders identically to its real home in the AppShell
 * bottom dock.
 */
export function ThemeToggleShowcase(): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="none" className="border-border bg-card w-60 rounded-md border">
        <SidebarContent>
          <SidebarMenu className="p-md gap-3xs">
            <ThemeToggleInline />
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
