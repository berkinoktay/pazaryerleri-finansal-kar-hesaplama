'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { HelpMenu } from '@/components/layout/help-menu';
import {
  filterNavGroupsByPlatform,
  HELP_MENU_ITEMS,
  NAV_GROUPS,
} from '@/components/layout/nav-config';
import { BottomDock } from '@/components/patterns/bottom-dock';
import { NavGroup, NAV_BADGE_TONE } from '@/components/patterns/nav-group';
import { NotificationBell, type NotificationEntry } from '@/components/patterns/notification-bell';
import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
  type UsePreviewStores,
} from '@/components/patterns/org-store-switcher';
import { Badge } from '@/components/ui/badge';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/features/auth/components/user-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

// MOCK ENTRIES — same fixture pattern as before. The desktop footer bell and
// the mobile header bell should converge on a `useNotifications()` hook when
// the /v1/notifications endpoint ships. For now the mock keeps both visible.
// TODO: replace MOCK with useNotifications() when the feed endpoint lands.
const MOCK_NOTIFICATIONS: NotificationEntry[] = [
  { id: '1', icon: 'success', title: 'Sipariş senkronizasyonu tamam', timestamp: '3 dk' },
  { id: '2', icon: 'warning', title: '2 iade incelemeyi bekliyor', timestamp: '15 dk' },
];

/**
 * Active-state + sizing overrides for a LEAF primary nav row (a destination
 * with no children: Dashboard, Orders, Products, …).
 *
 *   1. Active fill — the Sidebar primitive's default
 *      `data-[active=true]:bg-sidebar-accent` resolves to a near-neutral that
 *      reads like hover. We replace it with the dedicated
 *      `bg-sidebar-active` (primary-tinted surface) + brand foreground — a
 *      restrained "you are here" that's calmer than the old full bg-primary
 *      fill. The `data-[active=true]:hover:*` pair keeps the surface stable on
 *      hover of an already-active row.
 *   2. Bigger icons — 20px (`size-icon-lg`) over the primitive's 16px.
 *   3. Collapsed sizing — 40px button + 6px padding to sit centered in the
 *      56px icon rail (`--sidebar-width-icon` on SidebarProvider), label hidden.
 */
const NAV_ITEM_CLASSES = cn(
  'data-[active=true]:bg-sidebar-active data-[active=true]:text-sidebar-active-foreground',
  'data-[active=true]:hover:bg-sidebar-active data-[active=true]:hover:text-sidebar-active-foreground',
  'h-9 [&>svg]:size-icon-lg!',
  'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1.5!',
  'group-data-[collapsible=icon]:justify-center',
  'group-data-[collapsible=icon]:[&>span]:hidden',
);

/**
 * Active-state + sizing for a GROUP PARENT row (a destination WITH children:
 * Tools & Pricing). Branch-active treatment: when a child route is active the
 * parent shows brand text/icon but NO surface fill — the active leaf carries
 * the `bg-sidebar-active` surface, so we avoid a double-filled parent+child.
 *
 * Exception: in collapsed (icon-only) mode the sub-list is hidden, so the
 * parent itself must carry the surface to signal active — hence the
 * `group-data-[collapsible=icon]:data-[active=true]:bg-sidebar-active` add-back.
 */
const NAV_GROUP_PARENT_CLASSES = cn(
  'data-[active=true]:bg-transparent data-[active=true]:text-sidebar-active-foreground',
  'data-[active=true]:hover:bg-sidebar-accent data-[active=true]:hover:text-sidebar-active-foreground',
  'group-data-[collapsible=icon]:data-[active=true]:bg-sidebar-active',
  'h-9 [&>svg]:size-icon-lg!',
  'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1.5!',
  'group-data-[collapsible=icon]:justify-center',
  'group-data-[collapsible=icon]:[&>span]:hidden',
);

/**
 * Submenu link styling (NavGroup children). Indented (no left guide line),
 * sidebar-namespaced at rest. Active leaf lifts to the primary-soft surface
 * (`bg-sidebar-active`) + brand text — the SAME token the parent uses, so the
 * active branch reads as one connected highlight without a rule.
 */
const SUB_NAV_LINK_CLASSES = cn(
  'duration-fast px-xs py-2xs text-xs rounded-sm transition-colors',
  'text-sidebar-foreground-dim hover:bg-sidebar-accent hover:text-sidebar-foreground',
);
const SUB_NAV_LINK_ACTIVE_CLASSES = cn(
  'bg-sidebar-active text-sidebar-active-foreground font-medium',
  'hover:bg-sidebar-active hover:text-sidebar-active-foreground',
);

/**
 * Collapsed-rail width override. The shadcn default 48px leaves no room for a
 * 40px button + gutter; 56px gives every collapsed element (org chip, nav
 * buttons, footer utilities, avatar) the same 40px hit target with even margins.
 */
const COLLAPSED_RAIL_STYLE = {
  '--sidebar-width-icon': '56px',
} as React.CSSProperties;

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
  /** Cross-org store pick — switches org AND store in one step. */
  onSelectScope: (orgId: string, storeId: string, storeName: string) => void;
  /** Optional CTA in the org/store picker to connect a new store. */
  onAddStore?: () => void;
  /** Feature-owned adapter injected into the switcher's cross-org preview. */
  usePreviewStores: UsePreviewStores;
  children: React.ReactNode;
}

/**
 * Single-sidebar shell on the shadcn Sidebar primitive. Composes:
 *
 *   - SidebarHeader → Wordmark + SidebarTrigger + OrgStoreSwitcher
 *   - SidebarContent → NAV_GROUPS rendered as labelled SidebarGroups; leaf
 *     rows as SidebarMenuButtons, destination groups (Tools) as NavGroup
 *     accordions.
 *   - SidebarFooter → BottomDock with the bottom utility cluster: a labelled
 *     Bildirimler row (NotificationBell), the Yardım & Destek menu, and the
 *     UserMenu.
 *   - SidebarInset → mobile-only inline header + the <main> content region.
 *
 * The shadcn Sidebar handles desktop expand/collapse to icon-only mode, mobile
 * drawer behavior, and the ⌘B / Ctrl+B shortcut out of the box.
 */
export function AppShell({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  onSelectScope,
  onAddStore,
  usePreviewStores,
  children,
}: AppShellProps): React.ReactElement {
  const t = useTranslations();
  return (
    <SidebarProvider defaultOpen style={COLLAPSED_RAIL_STYLE}>
      <AppSidebar
        orgs={orgs}
        stores={stores}
        activeOrgId={activeOrgId}
        activeStoreId={activeStoreId}
        onSelectOrg={onSelectOrg}
        onSelectStore={onSelectStore}
        onSelectScope={onSelectScope}
        onAddStore={onAddStore}
        usePreviewStores={usePreviewStores}
      />
      {/*
        SidebarInset renders the <main role="main"> landmark. Inside it: a
        mobile-only inline header (hamburger + brand + bell + user menu),
        followed by the page content. The drawer mode covers small viewports.
      */}
      {/* min-w-0: without it this flex-1 row item grows to fit wide content
          (e.g. the commission-tariff band table), pushing the page past the
          viewport and over the sidebar. min-w-0 lets it shrink so wide tables
          scroll inside their own DataTable instead. */}
      <SidebarInset id="main" className="min-w-0">
        <header className="border-border gap-xs px-sm py-3xs flex h-12 items-center justify-between border-b md:hidden">
          <div className="gap-xs flex items-center">
            <SidebarTrigger aria-label={t('nav.toggleSidebar')} />
            <Wordmark withText={false} />
          </div>
          <div className="gap-xs flex items-center">
            <NotificationBell entries={MOCK_NOTIFICATIONS} unreadCount={2} />
            <UserMenu placement="header" />
          </div>
        </header>
        {/*
          No `max-w-content-max` — the dashboard is data-dense and benefits
          from filling wide viewports. Pages that need a reading-width cap opt
          in per-page (max-w-prose-max / max-w-form / …).
        */}
        <div className="gap-lg px-md py-md md:px-2xl md:py-xl flex w-full min-w-0 flex-1 flex-col overflow-y-auto">
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
  onSelectScope: (orgId: string, storeId: string, storeName: string) => void;
  onAddStore?: () => void;
  usePreviewStores: UsePreviewStores;
}

function AppSidebar({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  onSelectScope,
  onAddStore,
  usePreviewStores,
}: AppSidebarProps): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  // Marketplace-specific groups (e.g. Campaigns) only render for the matching
  // platform. Derive it from the active store rather than a separate hook so
  // the sidebar stays in sync with the store the rest of the shell is showing.
  const activePlatform = stores.find((store) => store.id === activeStoreId)?.platform ?? null;
  const visibleGroups = filterNavGroupsByPlatform(NAV_GROUPS, activePlatform);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-xs">
        <div className="gap-xs px-xs py-3xs flex items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Wordmark
            withText
            className="text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          />
          <SidebarTrigger
            aria-label={t('nav.toggleSidebar')}
            className="[&>svg]:size-icon-lg ml-auto size-9 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:size-10"
          />
        </div>
        <div className="px-xs group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <OrgStoreSwitcher
            orgs={orgs}
            stores={stores}
            activeOrgId={activeOrgId ?? null}
            activeStoreId={activeStoreId ?? null}
            onSelectOrg={onSelectOrg}
            onSelectStore={onSelectStore}
            onSelectScope={onSelectScope}
            onAddStore={onAddStore}
            usePreviewStores={usePreviewStores}
            collapsed={collapsed}
          />
        </div>
        {/*
          Zone divider — closes the "context selector" header and opens the
          navigation list below, matching Linear/Stripe/Vercel sidebar IA.
        */}
        <SidebarSeparator className="bg-border/60 mt-2xs mx-0" />
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((entry) => {
                const match = entry.activeMatch ?? entry.href;
                const isActive = pathname === match || pathname.startsWith(`${match}/`);
                const Icon = entry.icon;
                const TrailingMark = entry.trailingMark;

                if ('sections' in entry && entry.sections) {
                  return (
                    <SidebarMenuItem key={entry.key}>
                      <NavGroup
                        label={t(entry.labelKey)}
                        icon={<Icon />}
                        badge={entry.badge}
                        href={entry.href}
                        isActive={isActive}
                        defaultExpanded={isActive}
                        buttonClassName={NAV_GROUP_PARENT_CLASSES}
                      >
                        {entry.sections.flatMap((section) =>
                          section.items.map((item) => {
                            const subActive =
                              pathname === item.href || pathname.startsWith(`${item.href}/`);
                            return (
                              <Link
                                key={item.key}
                                href={item.href}
                                aria-current={subActive ? 'page' : undefined}
                                className={cn(
                                  SUB_NAV_LINK_CLASSES,
                                  subActive && SUB_NAV_LINK_ACTIVE_CLASSES,
                                )}
                              >
                                {t(item.labelKey)}
                              </Link>
                            );
                          }),
                        )}
                      </NavGroup>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={entry.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={t(entry.labelKey)}
                      aria-label={t(entry.labelKey)}
                      className={NAV_ITEM_CLASSES}
                    >
                      <Link href={entry.href}>
                        <Icon />
                        <span className="flex-1">{t(entry.labelKey)}</span>
                        {entry.badge ? (
                          <Badge
                            tone={NAV_BADGE_TONE[entry.badge.variant]}
                            size="sm"
                            radius="sm"
                            className="group-data-[collapsible=icon]:hidden"
                          >
                            {entry.badge.label}
                          </Badge>
                        ) : null}
                        {TrailingMark ? (
                          <TrailingMark className="h-3.5 w-auto shrink-0 group-data-[collapsible=icon]:hidden" />
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <BottomDock>
          {/*
            Bottom utility cluster (design spec §4.7): a labelled Bildirimler
            row + the Yardım & Destek menu sit above the user identity card.
            The bell lives here (not the header) to keep the top row — Wordmark
            + collapse toggle — uncrowded and unambiguous.
          */}
          <SidebarMenu>
            <SidebarMenuItem>
              <NotificationBell
                entries={MOCK_NOTIFICATIONS}
                unreadCount={MOCK_NOTIFICATIONS.length}
                variant="sidebar"
              />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <HelpMenu items={HELP_MENU_ITEMS} />
            </SidebarMenuItem>
          </SidebarMenu>
          <UserMenu />
        </BottomDock>
      </SidebarFooter>
      <SidebarRail aria-label={t('nav.toggleSidebar')} title={t('nav.toggleSidebar')} />
    </Sidebar>
  );
}
