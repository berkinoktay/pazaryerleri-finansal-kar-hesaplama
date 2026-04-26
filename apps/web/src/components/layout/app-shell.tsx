'use client';

import { HelpCircleIcon, Settings02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { isNavDivider, NAV_ENTRIES } from '@/components/layout/nav-config';
import { BottomDock } from '@/components/patterns/bottom-dock';
import { NavGroup } from '@/components/patterns/nav-group';
import { NotificationBell, type NotificationEntry } from '@/components/patterns/notification-bell';
import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
} from '@/components/patterns/org-store-switcher';
import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/features/auth/components/user-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

// MOCK ENTRIES — same fixture pattern as the previous shell.  Both
// surfaces (mobile inline header bell + future bell consumers) should
// converge on a `useNotifications()` hook when the /v1/notifications
// endpoint ships.  For now the mock keeps the bell visible.
// TODO: replace MOCK with useNotifications() when the feed endpoint lands.
const MOCK_NOTIFICATIONS: NotificationEntry[] = [
  { id: '1', icon: 'success', title: 'Sipariş senkronizasyonu tamam', timestamp: '3 dk' },
  { id: '2', icon: 'warning', title: '2 iade incelemeyi bekliyor', timestamp: '15 dk' },
];

export interface AppShellProps {
  /** All organizations the current user is a member of. */
  orgs: Organization[];
  /** Stores belonging to the active org (already mapped to switcher shape). */
  stores: Store[];
  /** Currently active org id; undefined when no org is selected. */
  activeOrgId: string | undefined;
  /** Currently active store id; undefined when no store is selected. */
  activeStoreId: string | undefined;
  /** Org switch handler — wired to setActiveOrgIdAction + router.refresh. */
  onSelectOrg: (orgId: string) => void;
  /** Store switch handler — wired to setActiveStoreIdAction. */
  onSelectStore: (storeId: string) => void;
  /** Optional CTA at the bottom of the org/store dropdown to connect a new store. */
  onAddStore?: () => void;
  children: React.ReactNode;
}

/**
 * Single-sidebar shell built on the shadcn Sidebar primitive — replaces
 * the previous 3-rail (IconRail + ContextRail + Main) layout. Composes
 * four Phase-1 patterns:
 *
 *   - SidebarHeader → Wordmark + SidebarTrigger + OrgStoreSwitcher
 *   - SidebarContent → NAV_ENTRIES rendered as SidebarMenu items, with
 *     groups (NavGroup) for nested feature routes and dividers as
 *     dashed separators.
 *   - SidebarFooter → BottomDock with Destek + Ayarlar links,
 *     ThemeToggleInline, divider, and the UserMenu.
 *   - SidebarInset → mobile-only inline header with a SidebarTrigger,
 *     the Wordmark mark (no text), bell, user menu; plus the <main>
 *     content region.
 *
 * The shadcn Sidebar handles desktop expand/collapse to icon-only mode,
 * mobile drawer behavior, and keyboard shortcut (⌘B / Ctrl+B) out of
 * the box.
 */
export function AppShell({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  children,
}: AppShellProps): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar
        orgs={orgs}
        stores={stores}
        activeOrgId={activeOrgId}
        activeStoreId={activeStoreId}
        onSelectOrg={onSelectOrg}
        onSelectStore={onSelectStore}
      />
      {/*
        SidebarInset itself renders a <main role="main"> landmark —
        that's the page's primary content region. Inside it we place a
        mobile-only inline header (hamburger + brand + bell + user menu)
        followed by the actual page content. The shadcn Sidebar's drawer
        mode handles small viewports out of the box; the inline header
        only needs to keep the bell + user menu reachable.
      */}
      <SidebarInset id="main">
        <header className="border-border gap-xs px-sm py-3xs flex h-12 items-center justify-between border-b md:hidden">
          <div className="gap-xs flex items-center">
            <SidebarTrigger />
            <Wordmark withText={false} />
          </div>
          <div className="gap-xs flex items-center">
            <NotificationBell entries={MOCK_NOTIFICATIONS} unreadCount={2} />
            <UserMenu />
          </div>
        </header>
        <div className="max-w-content-max gap-lg px-sm py-sm md:px-lg md:py-lg mx-auto flex w-full flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

interface AppSidebarProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | undefined;
  activeStoreId: string | undefined;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
}

function AppSidebar({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
}: AppSidebarProps): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-xs">
        <div className="gap-xs px-xs py-3xs flex items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Wordmark withText className="group-data-[collapsible=icon]:hidden" />
          <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
        </div>
        <div className="px-xs group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <OrgStoreSwitcher
            orgs={orgs}
            stores={stores}
            activeOrgId={activeOrgId ?? null}
            activeStoreId={activeStoreId ?? null}
            onSelectOrg={onSelectOrg}
            onSelectStore={onSelectStore}
            collapsed={collapsed}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ENTRIES.map((entry) => {
              if (isNavDivider(entry)) {
                return (
                  <SidebarMenuItem key={entry.key} className="group-data-[collapsible=icon]:hidden">
                    <hr
                      className="border-border mx-xs my-xs border-t border-dashed"
                      role="separator"
                    />
                  </SidebarMenuItem>
                );
              }
              const isActive = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
              const Icon = entry.icon;
              if ('sections' in entry && entry.sections) {
                return (
                  <SidebarMenuItem key={entry.key}>
                    <NavGroup
                      label={t(entry.labelKey)}
                      icon={<Icon className="size-icon-sm" />}
                      badge={entry.badge}
                      href={entry.href}
                      isActive={isActive}
                      defaultExpanded={isActive}
                    >
                      {entry.sections.flatMap((section) =>
                        section.items.map((item) => (
                          <Link
                            key={item.key}
                            href={item.href}
                            className={cn(
                              'hover:bg-muted text-muted-foreground hover:text-foreground px-xs py-3xs text-2xs rounded-sm',
                              pathname.startsWith(item.href) && 'bg-accent text-accent-foreground',
                            )}
                          >
                            {t(item.labelKey)}
                          </Link>
                        )),
                      )}
                    </NavGroup>
                  </SidebarMenuItem>
                );
              }
              return (
                <SidebarMenuItem key={entry.key}>
                  <SidebarMenuButton asChild isActive={isActive} tooltip={t(entry.labelKey)}>
                    <Link href={entry.href}>
                      <Icon className="size-icon-sm" />
                      <span>{t(entry.labelKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <BottomDock>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={t('nav.support')}>
                <Link href="/support">
                  <HelpCircleIcon className="size-icon-sm" />
                  <span>{t('nav.support')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={t('nav.settings')}>
                <Link href="/settings/profile">
                  <Settings02Icon className="size-icon-sm" />
                  <span>{t('nav.settings')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <ThemeToggleInline />
          <BottomDock.Divider />
          <UserMenu />
        </BottomDock>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
