'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { AUX_NAV_ITEMS, isNavDivider, NAV_ENTRIES } from '@/components/layout/nav-config';
import { BottomDock } from '@/components/patterns/bottom-dock';
import { NavGroup } from '@/components/patterns/nav-group';
import { NotificationBell, type NotificationEntry } from '@/components/patterns/notification-bell';
import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
} from '@/components/patterns/org-store-switcher';
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
  SidebarSeparator,
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

/**
 * Consumer-level overrides for primary sidebar nav buttons.
 *
 * Three concerns layered into a single class string so every nav row
 * (NAV_ENTRIES + Help in the footer) stays visually identical:
 *
 *   1. Active-state fill — the Sidebar primitive's default
 *      `data-[active=true]:bg-sidebar-accent` resolves to muted, which is
 *      indistinguishable from hover. We replace it with `bg-primary`
 *      + `text-primary-foreground`; the SVG icon inherits via
 *      `currentColor`. The `data-[active=true]:hover:*` pair keeps the
 *      primary fill stable on hover of an already-active row — without
 *      it the row would flicker back to muted on mouse-over.
 *
 *   2. Bigger icons — the primitive's CVA pins `[&>svg]:size-4` (16px)
 *      via a descendant selector that out-specifies a class on the SVG
 *      itself. We override with `[&>svg]:size-icon-lg!` (20px) for
 *      better glanceability in both modes.
 *
 *   3. Collapsed-mode sizing — the primitive forces
 *      `group-data-[collapsible=icon]:size-8!` (32px button, 8px
 *      padding). With our 56px-wide collapsed rail (set on
 *      SidebarProvider via `--sidebar-width-icon`), 40px buttons with
 *      6px padding sit centered with 8px gutter on each side and
 *      comfortably fit 20px icons. Expanded rows bump from h-8 to h-9
 *      so 20px icons keep ~2px vertical breathing room.
 */
const NAV_ITEM_CLASSES = cn(
  // bg-primary/90 (slight alpha) softens the loud full-fill of the
  // active nav row — still glanceable as "selected" but less aggressive
  // against the surrounding muted nav. Token-stable across light/dark.
  'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
  'data-[active=true]:hover:bg-primary/90 data-[active=true]:hover:text-primary-foreground',
  'h-9 [&>svg]:size-icon-lg!',
  'group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-1.5!',
  // Collapsed-mode label hide + center. Without justify-center the icon
  // sits flex-start (left-aligned) because the now-hidden label span no
  // longer pushes it; with the label hidden, gap-2 has no effect (only
  // one child). The org-switcher chip uses the same justify-center +
  // hidden-label combo, keeping every collapsed element centered in its
  // 40px box.
  'group-data-[collapsible=icon]:justify-center',
  'group-data-[collapsible=icon]:[&>span]:hidden',
);

/**
 * Submenu link styling — used by NavGroup children in the AppShell
 * mapper. Bumped from `text-2xs` to `text-xs` (13px) and from
 * `py-3xs` to `py-2xs` (4px) for readability per the design refresh.
 * Active state is a primary-tinted surface (`bg-primary/10`) with
 * `text-primary` to align with the parent active row's primary fill,
 * but at lower intensity so the parent stays the dominant signal.
 * The alpha lives on the primary token (theme-aware in both light and
 * dark), not on a flat color.
 */
// Sub-nav rows use the sidebar-namespaced tokens so they adapt cleanly
// to the rail's color (--sidebar-foreground for full-strength text,
// --sidebar-foreground-dim for at-rest, --sidebar-accent for hover).
// Active state lifts the row to a primary-tinted surface with brand
// text — pairs with the parent row's full bg-primary fill at lower
// intensity so the parent stays the dominant "you are here" cue.
const SUB_NAV_LINK_CLASSES = cn(
  'duration-fast px-xs py-2xs text-xs rounded-sm transition-colors',
  'text-sidebar-foreground-dim hover:bg-sidebar-accent hover:text-sidebar-foreground',
);
const SUB_NAV_LINK_ACTIVE_CLASSES =
  'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary font-medium';

/**
 * Collapsed-rail width override. The shadcn primitive's default 48px
 * leaves no room for a 40px button + 8px gutter, forcing icons to
 * 32px / 16px. Bumping to 56px gives every collapsed element (org
 * chip, nav buttons, user avatar) the same 40px hit target with even
 * margins — addressing the "all icons aligned and centered" ask.
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
    <SidebarProvider defaultOpen style={COLLAPSED_RAIL_STYLE}>
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
        {/*
          No `max-w-content-max` here — the dashboard is data-dense
          (tables, KPI grids, charts) and benefits from filling 4K /
          ultra-wide viewports rather than reserving 2000+px of empty
          gutter. Pages that genuinely need a reading-width cap
          (settings forms, prose, marketing-style content) opt in
          per-page with `max-w-prose-max` / `max-w-form` / etc.
        */}
        <div className="gap-lg px-md py-md md:px-2xl md:py-xl flex w-full flex-1 flex-col overflow-y-auto">
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
    // Default 'sidebar' variant — the dark brand-tinted rail (see
    // tokens/colors.css) carries the visual identity on its own; no
    // floating-card inset trick needed. The high-contrast boundary
    // between dark sidebar and bright main content is the separation.
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-xs">
        <div className="gap-xs px-xs py-3xs flex items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          {/*
            text-sidebar-foreground keeps the wordmark synced with the
            rail's foreground token in both light AND dark mode — the
            mark reads correctly whichever theme is active.
          */}
          <Wordmark
            withText
            className="text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          />
          <SidebarTrigger className="[&>svg]:size-icon-lg ml-auto size-9 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:size-10" />
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
        {/*
          Zone divider — visually closes the "context selector" header
          and opens the navigation list below. Without it the switcher
          chip risks reading as just another nav row; with it, the
          information architecture is explicit (header zone vs. nav zone),
          matching Linear/Stripe/Vercel sidebar patterns.
        */}
        <SidebarSeparator className="bg-border/60 mt-2xs mx-0" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ENTRIES.map((entry) => {
              if (isNavDivider(entry)) {
                return (
                  <li key={entry.key} className="my-2xs px-xs group-data-[collapsible=icon]:hidden">
                    <SidebarSeparator className="bg-border/60 mx-0" />
                  </li>
                );
              }
              const isActive = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
              const Icon = entry.icon;
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
                      buttonClassName={NAV_ITEM_CLASSES}
                    >
                      {entry.sections.flatMap((section) =>
                        section.items.map((item) => {
                          const subActive = pathname.startsWith(item.href);
                          return (
                            <Link
                              key={item.key}
                              href={item.href}
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
                    className={NAV_ITEM_CLASSES}
                  >
                    <Link href={entry.href}>
                      <Icon />
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
          {/*
            Auxiliary nav cluster — "Yenilikler" + "Destek" share the
            same bottom shelf as utility links (matches the Linear /
            Vercel pattern of grouping non-feature pages with the user
            menu, separate from the main nav scroll).
          */}
          <SidebarMenu>
            {AUX_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={t(item.labelKey)}
                    className={NAV_ITEM_CLASSES}
                  >
                    <Link href={item.href}>
                      <Icon />
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
          <UserMenu />
        </BottomDock>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
