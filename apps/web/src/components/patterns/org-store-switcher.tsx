'use client';

import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getOrgAvatarPalette, type OrgAvatarPalette } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import { OrgStoreSwitcherEmpty, OrgStoreSwitcherList } from './org-store-switcher-list';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type SyncState = 'fresh' | 'stale' | 'failed';

export interface Organization {
  id: string;
  name: string;
  role: OrgRole;
  storeCount: number;
  lastSyncedAt: string | null;
  /** ISO timestamp of when the caller last switched into this org;
   * `null` means never accessed. Powers the "Son Kullanılan" section
   * when the user belongs to 5+ orgs. */
  lastAccessedAt: string | null;
}

export interface Store {
  id: string;
  name: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  syncState: SyncState;
  lastSyncedAt: string | null;
}

export interface OrgStoreSwitcherProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
  /** Collapsed sidebar mode — render icon-only avatar trigger. */
  collapsed?: boolean;
}

const PALETTE_BG: Record<OrgAvatarPalette, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
};

const SYNC_BG: Record<SyncState, string> = {
  fresh: 'bg-success',
  stale: 'bg-warning',
  failed: 'bg-destructive',
};

/** Border tint applied to the chip itself when the active store has a
 * non-fresh sync state. Default `border-border` is a soft persistent
 * frame that — paired with shadow-sm — gives the chip its "elevated
 * dropdown trigger" identity. Stale/failed override the color to surface
 * a glanceable warning cue (width stays stable across states). */
const SYNC_CHIP_BORDER: Record<SyncState, string> = {
  fresh: 'border-border',
  stale: 'border-warning',
  failed: 'border-destructive',
};

/** When the user belongs to this many orgs, the collapsed avatar
 * shows a "+N" indicator on its bottom-left to signal "there are more
 * orgs to switch to". */
const MULTI_ORG_INDICATOR_THRESHOLD = 3;

/**
 * Combined org+store switcher chip with layered popover dropdown.
 *
 * Surface design:
 *   - Default: `bg-card` + `shadow-xs` — hairline elevation that signals
 *     "this is a control, not a label" without reading as a floating
 *     popup. Per `tokens/shadow.css`, xs is the right level for raised
 *     chips (md/lg are reserved for genuine overlays). Pairs with a
 *     SidebarSeparator below in AppShell to structurally anchor the
 *     "context zone" away from the navigation list.
 *   - Hover / popover-open: `bg-muted` + drop the shadow flat. The bg
 *     shift becomes the active elevation signal; a flat-hover feels
 *     more "engaged" than a hovered card. No border bump on open.
 *   - Sync warning (stale/failed): the otherwise-transparent border
 *     tints to `border-warning` / `border-destructive`. Width stays
 *     stable because the border slot is always present.
 *
 * Avatar:
 *   - When an active store is selected, shows the marketplace's brand
 *     wordmark (Trendyol/Hepsiburada) on a card surface — the user is
 *     "currently working in marketplace X for org Y", and the brand
 *     identity is the primary glanceable signal.
 *   - When an active org has no store yet, falls back to the org's
 *     initial on a deterministic palette tile (info/success/warning/etc).
 *   - When there's no org at all, shows a `+` placeholder.
 *   - No corner overlays. Sync state and platform identity surface
 *     through the secondary text line and the popover dropdown — the
 *     avatar carries one concept at a time.
 *
 * Power features:
 *   - **⌘O / Ctrl+O** opens the popover from anywhere on the page.
 *   - **Sync warning border** — when the active store's sync state is
 *     `stale` or `failed`, the chip's outer border tints to surface
 *     the warning at the sidebar level.
 *   - **Multi-org +N indicator** — collapsed avatar's bottom-left
 *     shows "+N" when the user belongs to 3+ orgs.
 */
export function OrgStoreSwitcher({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  collapsed = false,
}: OrgStoreSwitcherProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const [open, setOpen] = React.useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const activeStore = stores.find((s) => s.id === activeStoreId) ?? null;
  const isEmpty = orgs.length === 0;
  const otherOrgCount = Math.max(0, orgs.length - 1);
  const showMultiOrgIndicator =
    collapsed && orgs.length >= MULTI_ORG_INDICATOR_THRESHOLD && otherOrgCount > 0;
  const chipBorder = activeStore ? SYNC_CHIP_BORDER[activeStore.syncState] : 'border-border';

  // Global ⌘O / Ctrl+O hotkey.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'o' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const triggerLabel = activeOrg
    ? activeStore
      ? `${activeOrg.name} · ${activeStore.name}`
      : activeOrg.name
    : t('emptyCreate');

  const triggerButton = (
    <button
      type="button"
      aria-label={triggerLabel}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'group duration-fast flex items-center rounded-md border transition-all',
        // Confident elevation: bg-card + visible border + shadow-sm.
        // The trio reads as "primary dropdown trigger" — distinct from
        // both nav rows (no card/shadow) and from popovers (md/lg shadow).
        // Pairs with the separator below for IA-level zone framing.
        'bg-card hover:bg-muted shadow-sm',
        // Drop the shadow on hover/open: the bg shift becomes the active
        // elevation signal, flat-hover feels engaged ("being clicked").
        'data-[state=open]:bg-muted hover:shadow-none data-[state=open]:shadow-none',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        // chipBorder is `border-border` for fresh, warning/destructive for
        // stale/failed — overrides the base `border` color via twMerge.
        chipBorder,
        collapsed
          ? 'size-10 justify-center p-0 pointer-coarse:size-11'
          : 'gap-xs px-2xs py-xs w-full',
      )}
    >
      <SwitcherAvatar
        org={activeOrg}
        activeStore={activeStore}
        showMultiOrgIndicator={showMultiOrgIndicator}
        otherOrgCount={otherOrgCount}
        multiOrgLabel={t('multiOrgIndicator', { count: otherOrgCount })}
      />
      {!collapsed ? (
        <>
          <span className="gap-3xs flex min-w-0 flex-1 flex-col items-start overflow-hidden">
            <span className="text-foreground w-full truncate text-left text-sm leading-tight font-semibold">
              {activeOrg?.name ?? t('emptyCreate')}
            </span>
            {activeStore ? (
              <span className="text-muted-foreground gap-3xs text-2xs flex w-full items-center truncate text-left leading-tight">
                <span
                  aria-hidden
                  className={cn(
                    'animate-sync-pulse size-2 shrink-0 rounded-full',
                    SYNC_BG[activeStore.syncState],
                  )}
                />
                <span className="truncate">{activeStore.name}</span>
              </span>
            ) : null}
          </span>
          <span
            aria-hidden
            className={cn(
              // Chevron pill: a small bg-muted square that visually frames
              // the chevron as a dedicated "open dropdown" affordance.
              // Linear/Vercel/Mercury-style — separates the "info display"
              // (org + store) from the "click target" semantic on the right.
              'flex size-7 shrink-0 items-center justify-center rounded-sm',
              // Pill bg stays muted at rest AND on hover. On hover the chip
              // bg shifts to muted too, so the pill visually blends — leaving
              // the chevron itself (now darkened) as the focal "click here"
              // signal. Reverting to bg-card on hover (previous version)
              // collided with the inner Trendyol avatar tile (also bg-card),
              // creating two competing white tiles inside a muted chip.
              // Open state surfaces primary tint as a clear "dropdown is open" cue.
              'bg-muted text-muted-foreground duration-fast transition-colors',
              'group-hover:text-foreground',
              'group-data-[state=open]:bg-primary/10 group-data-[state=open]:text-primary',
            )}
          >
            <ArrowDown01Icon className="size-icon-sm duration-fast transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </>
      ) : null}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="gap-3xs flex flex-col">
            <span className="text-2xs font-medium">{triggerLabel}</span>
            <span className="text-2xs opacity-70">{t('openShortcut')}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        side={collapsed ? 'right' : 'bottom'}
        // overflow-hidden caps the panel at w-dropdown-popover so footer
        // buttons can't push the width beyond the sidebar — flex children
        // with min-width:auto would otherwise expand the popover to fit
        // their content. Pairs with icon-only secondary footer buttons.
        className="w-dropdown-popover overflow-hidden p-0"
      >
        {isEmpty ? (
          <OrgStoreSwitcherEmpty />
        ) : (
          <OrgStoreSwitcherList
            orgs={orgs}
            stores={stores}
            activeOrgId={activeOrgId}
            activeStoreId={activeStoreId}
            onSelectOrg={(id) => {
              onSelectOrg(id);
              setOpen(false);
            }}
            onSelectStore={(id) => {
              onSelectStore(id);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

interface SwitcherAvatarProps {
  org: Organization | null;
  activeStore: Store | null;
  showMultiOrgIndicator: boolean;
  otherOrgCount: number;
  multiOrgLabel: string;
}

/**
 * 40px avatar that swaps identity based on what the user has selected:
 *
 *   1. Active store present → marketplace brand wordmark on a card
 *      surface, contained by `overflow-hidden` so the wide-aspect SVG
 *      crops cleanly inside a 40×40 square. The wordmark itself is
 *      `size="md"` (28px tall) — large enough to read the brand at a
 *      glance both in expanded chip and collapsed-rail contexts.
 *   2. Active org without an active store → org initial on a palette-
 *      tinted tile (deterministic per-org color from `getOrgAvatarPalette`).
 *   3. No org at all → `+` placeholder on muted bg.
 *
 * No corner overlays. Sync state and platform-as-text are conveyed by
 * the chip's secondary text row and the dropdown panel — the avatar
 * carries exactly one signal.
 *
 * Multi-org indicator (collapsed-mode only) is the one exception: a
 * tiny "+N" tile clipped to the bottom-left, which only renders in the
 * icon-only sidebar where the org-count cue would otherwise be lost.
 */
function SwitcherAvatar({
  org,
  activeStore,
  showMultiOrgIndicator,
  otherOrgCount,
  multiOrgLabel,
}: SwitcherAvatarProps): React.ReactElement {
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
        {showMultiOrgIndicator ? (
          <MultiOrgPlus label={multiOrgLabel} count={otherOrgCount} />
        ) : null}
      </span>
    );
  }

  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toUpperCase();

  return (
    <span className="relative shrink-0">
      <Avatar size="md" className={cn('rounded-md', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-md text-sm font-semibold', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
      {showMultiOrgIndicator ? <MultiOrgPlus label={multiOrgLabel} count={otherOrgCount} /> : null}
    </span>
  );
}

function MultiOrgPlus({ label, count }: { label: string; count: number }): React.ReactElement {
  return (
    <span
      aria-label={`${count} more organization${count === 1 ? '' : 's'}`}
      className={cn(
        '-bottom-3xs -left-3xs ring-card bg-card text-foreground absolute',
        'text-2xs flex items-center justify-center rounded-sm leading-none font-semibold ring-2',
        'px-3xs py-3xs',
      )}
    >
      {label}
    </span>
  );
}
