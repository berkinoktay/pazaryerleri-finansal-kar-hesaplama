'use client';

import type { MemberRole, Platform } from '@pazarsync/db/enums';
import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import {
  OrgStoreSwitcherEmpty,
  OrgStoreSwitcherPanel,
} from '@/components/patterns/org-store-switcher-panel';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CountBadge } from '@/components/ui/count-badge';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { getOrgAvatarPalette, PALETTE_BG } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

// Domain alias for the DB MemberRole enum.
export type OrgRole = MemberRole;

export interface Organization {
  id: string;
  name: string;
  role: OrgRole;
}

export interface Store {
  id: string;
  name: string;
  platform: Platform;
}

/** Result of the injected preview-stores adapter (see `usePreviewStores`). */
export interface SwitcherPreviewStores {
  stores: Store[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Adapter the shell injects so the pattern can preview a non-active org's
 * stores WITHOUT importing feature internals. The feature owns the concrete
 * hook (`useSwitcherPreviewStores`); the pattern only knows this type shape.
 */
export type UsePreviewStores = (orgId: string | null) => SwitcherPreviewStores;

export interface OrgStoreSwitcherProps {
  orgs: Organization[];
  /** Stores of the ACTIVE org (server-hydrated). */
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  /** Org-only switch — used when the previewed org has no stores. */
  onSelectOrg: (orgId: string) => void;
  /** Same-org store switch. */
  onSelectStore: (storeId: string) => void;
  /** Cross-org store pick: switch org AND store in one step. */
  onSelectScope: (orgId: string, storeId: string, storeName: string) => void;
  /**
   * In-panel "connect a new store" action. When provided (the caller's role
   * grants it), the Stores section header surfaces a "+ Yeni Mağaza" button
   * that closes the shell and runs this — typically opening the connect-store
   * modal. When omitted, the header falls back to a settings-page link.
   */
  onAddStore?: () => void;
  /**
   * Injected adapter that previews a non-active org's stores. Dependency
   * injection keeps the pattern layer free of feature-folder imports — the
   * feature passes `useSwitcherPreviewStores`.
   */
  usePreviewStores: UsePreviewStores;
  /** Collapsed sidebar mode — render icon-only tile trigger. */
  collapsed?: boolean;
  /**
   * Register the global ⌘O / Ctrl+O toggle hotkey (default `true`). Set
   * `false` for secondary instances (e.g. multiple showcase demos on one page)
   * so a single keypress doesn't open every switcher at once.
   */
  hotkey?: boolean;
}

/**
 * Combined org+store switcher — a store-first identity card trigger backed by
 * a two-pane picker. The trigger reads as "you're working in store X (of org
 * Y)"; the picker previews any org's stores before you commit.
 *
 * Surface design:
 *   - Default: `bg-card` + `border-border` + `shadow-sm` — the trio reads as
 *     "primary dropdown trigger", distinct from nav rows (no card/shadow) and
 *     from overlays (md/lg shadow). Pairs with a SidebarSeparator below in
 *     AppShell to frame the "context zone".
 *   - Hover / open: `bg-muted` + drop the shadow flat — the bg shift becomes
 *     the active elevation signal, so a flat hover feels "engaged".
 *
 * Leading visual carries exactly one concept:
 *   - Active store → the marketplace brand wordmark on a card surface (the
 *     user is "working in marketplace X"). In collapsed mode a corner chip
 *     adds the org initial, since the org name has no text line to live on.
 *   - Active org without a store → the org initial on a deterministic palette.
 *   - No org at all → a `+` placeholder.
 *
 * Three shells, one picker body: a Popover on the expanded desktop rail, a
 * Dialog when the rail is collapsed (the popover would have nowhere to anchor
 * comfortably), and a bottom Drawer on mobile. **⌘O / Ctrl+O** toggles it open
 * from anywhere on the page.
 *
 * @useWhen mounting the primary tenant context chip in the sidebar (store-first identity, ⌘O hotkey, two-pane org/store picker across popover/dialog/drawer shells)
 */
export function OrgStoreSwitcher({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  onSelectScope,
  onAddStore,
  usePreviewStores,
  collapsed = false,
  hotkey = true,
}: OrgStoreSwitcherProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const activeStore = stores.find((s) => s.id === activeStoreId) ?? null;
  const isEmpty = orgs.length === 0;

  // Global ⌘O / Ctrl+O hotkey. The effect stays registered so hook order is
  // stable; when `hotkey` is off it early-returns before binding the listener.
  React.useEffect(() => {
    if (!hotkey) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'o' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey]);

  const triggerLabel = activeOrg
    ? activeStore
      ? `${activeOrg.name} · ${activeStore.name}`
      : activeOrg.name
    : t('emptyCreate');
  const primaryLabel = activeStore?.name ?? activeOrg?.name ?? t('emptyCreate');

  const triggerButton = (
    <button
      type="button"
      aria-label={triggerLabel}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'group duration-fast flex cursor-pointer items-center rounded-md border transition-all',
        // Confident elevation: bg-card + visible border + shadow-sm. Distinct
        // from both nav rows and popovers. Pairs with the separator below for
        // IA-level zone framing.
        'bg-card border-border hover:bg-muted shadow-sm',
        // Drop the shadow on hover/open: the bg shift becomes the active
        // elevation signal, flat-hover feels engaged ("being clicked").
        'data-[state=open]:bg-muted hover:shadow-none data-[state=open]:shadow-none',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        collapsed
          ? 'size-10 justify-center p-0 pointer-coarse:size-11'
          : 'gap-xs px-2xs py-xs w-full',
      )}
    >
      <SwitcherLeading org={activeOrg} activeStore={activeStore} collapsed={collapsed} />
      {!collapsed ? (
        <>
          <span className="gap-3xs flex min-w-0 flex-1 flex-col items-start overflow-hidden">
            <span className="text-foreground w-full truncate text-left text-sm leading-tight font-semibold">
              {primaryLabel}
            </span>
            {activeStore && activeOrg ? (
              <span className="text-muted-foreground text-2xs w-full truncate text-left leading-tight">
                {activeOrg.name}
              </span>
            ) : null}
          </span>
          <span
            aria-hidden
            className={cn(
              // Chevron pill: a small bg-muted square that frames the chevron as
              // a dedicated "open" affordance, separating the info display from
              // the click-target semantic on the right.
              'flex size-7 shrink-0 items-center justify-center rounded-sm',
              'bg-muted text-muted-foreground duration-fast transition-colors',
              'group-hover:text-foreground',
              'group-data-[state=open]:bg-primary-soft group-data-[state=open]:text-primary-soft-foreground',
            )}
          >
            <ArrowDown01Icon className="size-icon-sm duration-fast transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </>
      ) : null}
    </button>
  );

  const content = isEmpty ? (
    <OrgStoreSwitcherEmpty />
  ) : (
    <OrgStoreSwitcherPanel
      // Defensive remount if the active org changes externally while the shell
      // is open — resets the panel's internal previewOrgId to the new active org.
      key={activeOrgId ?? 'none'}
      orgs={orgs}
      activeOrgId={activeOrgId}
      activeStoreId={activeStoreId}
      activeOrgStores={stores}
      layout={isMobile ? 'stacked' : 'panes'}
      onSelectOrg={onSelectOrg}
      onSelectStore={onSelectStore}
      onSelectScope={onSelectScope}
      onAddStore={onAddStore}
      usePreviewStores={usePreviewStores}
      onRequestClose={() => setOpen(false)}
    />
  );

  // Mobile: a bottom drawer, regardless of the rail's collapsed state.
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
        <DrawerContent aria-describedby={undefined}>
          <DrawerTitle className="text-foreground px-md py-sm text-sm font-semibold">
            {t('dialogTitle')}
          </DrawerTitle>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  // Collapsed rail: a Dialog (a popover has nowhere comfortable to anchor off a
  // 40px tile), with the trigger's tooltip carrying the label + ⌘O hint.
  if (collapsed) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>{triggerButton}</DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="gap-2xs flex flex-col">
            <span className="text-2xs font-medium">{triggerLabel}</span>
            <KbdGroup aria-label={t('openShortcut')}>
              <Kbd>⌘</Kbd>
              <Kbd>O</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-modal gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="border-border px-md py-sm border-b text-sm font-semibold">
            {t('dialogTitle')}
          </DialogTitle>
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  // Expanded desktop rail: a popover anchored to the chip.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        // overflow-hidden caps the panel at w-switcher-panel so footer/grid
        // children can't push the width past the sidebar; the max-w opt-in caps
        // it to the viewport gap so it never overflows on a narrow screen.
        className="w-switcher-panel max-w-[var(--radix-popover-content-available-width)] overflow-hidden p-0"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

interface SwitcherLeadingProps {
  org: Organization | null;
  activeStore: Store | null;
  collapsed: boolean;
}

/**
 * 40px leading visual that swaps identity by what the user has selected:
 *
 *   1. Active store → marketplace brand wordmark on a card surface, clipped by
 *      `overflow-hidden` so the wide SVG crops cleanly. In collapsed mode a
 *      corner org-initial chip is added (the org name has no text line there).
 *   2. Active org without a store → org initial on a palette-tinted tile.
 *   3. No org at all → a `+` placeholder on a muted tile.
 */
function SwitcherLeading({
  org,
  activeStore,
  collapsed,
}: SwitcherLeadingProps): React.ReactElement {
  if (org === null) {
    return (
      <span
        aria-hidden
        className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md"
      >
        <PlusSignIcon className="size-icon-lg" />
      </span>
    );
  }

  if (activeStore !== null) {
    return (
      <span className="relative shrink-0">
        <span
          aria-hidden
          className="bg-card border-border flex size-10 items-center justify-center overflow-hidden rounded-md border"
        >
          <MarketplaceLogo platform={activeStore.platform} size="md" alt="" />
        </span>
        {collapsed ? (
          <CountBadge
            tone="primary"
            aria-label={org.name}
            className="ring-card -bottom-3xs -left-3xs px-3xs absolute h-4 min-w-4 rounded-sm ring-2"
          >
            {org.name.charAt(0).toLocaleUpperCase('tr')}
          </CountBadge>
        ) : null}
      </span>
    );
  }

  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toLocaleUpperCase('tr');

  return (
    <span className="shrink-0">
      <Avatar size="md" className={cn('rounded-md', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-md text-sm', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
