'use client';

import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

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

/**
 * Platform corner mark color for the chip's bottom-right badge.
 *
 * Trendyol's brand orange and Hepsiburada's brand red aren't ours to
 * own — but at this 12px corner-tile size, the wordmark from
 * MarketplaceLogo is unreadable. We instead use the SEMANTIC tokens
 * whose hues happen to read as the right vendor color:
 *   - Trendyol (#FF671D, vivid orange) ≈ `bg-warning` (amber-orange)
 *   - Hepsiburada (#FF6000, red-orange) ≈ `bg-destructive` (red)
 * This is documented in the wireframe spec as the explicit mapping
 * (Section 01 anatomy item 2). At larger sizes — e.g. dropdown store
 * rows — we still use the actual MarketplaceLogo SVG so the wordmark
 * is visible.
 */
const PLATFORM_CORNER_BG: Record<Store['platform'], string> = {
  TRENDYOL: 'bg-warning',
  HEPSIBURADA: 'bg-destructive',
};

/** Border tint applied to the chip itself when the active store has a
 * non-fresh sync state. The pulse dot signals the same thing inside
 * the row, but the chip border is a glanceable signal at the sidebar
 * level — the operator sees "something is off" without opening the
 * dropdown. Token-scaled, no raw colors. */
const SYNC_CHIP_BORDER: Record<SyncState, string> = {
  fresh: 'border-transparent',
  stale: 'border-warning',
  failed: 'border-destructive',
};

/** When the user belongs to this many orgs, the collapsed avatar
 * shows a "+N" indicator on its bottom-left to signal "there are more
 * orgs to switch to". Below this, the platform corner badge alone is
 * enough information density. */
const MULTI_ORG_INDICATOR_THRESHOLD = 3;

/**
 * Combined org+store switcher chip with layered popover dropdown.
 *
 * Single trigger surfaces both axes of context (which organization +
 * which marketplace store) so the user never has to step through two
 * separate menus. Expanded mode renders a 32px avatar with platform
 * corner badge + sync pulse + dual-line names; collapsed mode collapses
 * to an icon-only avatar but keeps the corner badges + hover tooltip.
 *
 * Power features:
 *   - **⌘O / Ctrl+O** opens the popover from anywhere on the page
 *     (handler lives here so the keystroke triggers the same controlled
 *     state as a click).
 *   - **Sync warning border** — when the active store's sync state is
 *     `stale` or `failed`, the chip's outer border tints to surface
 *     the warning at the sidebar level (no need to open the popover to
 *     see something is wrong).
 *   - **Multi-org indicator** — collapsed avatar's bottom-left shows
 *     "+N" when the user belongs to 3+ orgs, making "I have more orgs"
 *     legible without expanding the sidebar.
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
  const chipBorder = activeStore ? SYNC_CHIP_BORDER[activeStore.syncState] : 'border-transparent';

  // Global ⌘O / Ctrl+O hotkey — opens the popover from anywhere on the
  // page. Bound here so the keystroke flips the same controlled state
  // a click would. The browser uses ⌘O for "Open File" but only when
  // the active element is the page chrome; once we preventDefault, the
  // browser default is suppressed.
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
      className={cn(
        'group duration-fast flex items-center rounded-md border transition-colors',
        'hover:bg-muted bg-transparent',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        chipBorder,
        collapsed
          ? 'size-9 justify-center p-0 pointer-coarse:size-11'
          : 'gap-xs px-2xs py-2xs w-full',
      )}
    >
      {activeOrg ? (
        <OrgAvatarWithBadges
          org={activeOrg}
          activeStore={activeStore}
          showMultiOrgIndicator={showMultiOrgIndicator}
          otherOrgCount={otherOrgCount}
          multiOrgLabel={t('multiOrgIndicator', { count: otherOrgCount })}
        />
      ) : (
        <span
          aria-hidden
          className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md"
        >
          <PlusSignIcon className="size-icon-sm" />
        </span>
      )}
      {!collapsed ? (
        <>
          <span className="gap-3xs flex min-w-0 flex-1 flex-col items-start overflow-hidden">
            <span className="text-foreground w-full truncate text-left text-xs leading-tight font-medium">
              {activeOrg?.name ?? t('emptyCreate')}
            </span>
            {activeStore ? (
              <span className="text-muted-foreground gap-3xs text-2xs flex w-full items-center truncate text-left leading-tight">
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', SYNC_BG[activeStore.syncState])}
                />
                <span className="truncate">{activeStore.name}</span>
              </span>
            ) : null}
          </span>
          <ArrowDown01Icon
            className="size-icon-xs text-muted-foreground shrink-0 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
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
        className="w-dropdown-popover p-0"
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

interface OrgAvatarWithBadgesProps {
  org: Organization;
  activeStore: Store | null;
  showMultiOrgIndicator: boolean;
  otherOrgCount: number;
  multiOrgLabel: string;
}

/**
 * 32px avatar tile with up to three corner badges:
 *  - platform mark (sağ-alt) — small marketplace logo at xs (14px), ringed
 *    in `bg-card` to read clearly over the colored avatar. The brand color
 *    in the SVG carries the vendor signal — we don't tint the container.
 *  - sync pulse (sol-üst) — tiny 6px dot tinted by sync state (fresh/stale/
 *    failed). Only shown when an active store is selected.
 *  - multi-org indicator (sol-alt, collapsed-only) — "+N" chip when the
 *    user belongs to 3+ orgs.
 *
 * Avatar uses a SOLID palette background from the 6 semantic tokens
 * (primary/success/warning/info/destructive/accent) — no gradient, no
 * one-off colors.
 */
function OrgAvatarWithBadges({
  org,
  activeStore,
  showMultiOrgIndicator,
  otherOrgCount,
  multiOrgLabel,
}: OrgAvatarWithBadgesProps): React.ReactElement {
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toUpperCase();

  return (
    <span className="relative shrink-0">
      <Avatar size="sm" className={cn('rounded-md', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-md text-xs font-semibold', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
      {activeStore ? (
        <>
          <span
            aria-hidden
            className={cn(
              'top-3xs left-3xs ring-card absolute size-2 rounded-full ring-2',
              SYNC_BG[activeStore.syncState],
            )}
          />
          <span
            aria-hidden
            className={cn(
              '-bottom-3xs -right-3xs ring-card absolute size-3 rounded-sm ring-2',
              PLATFORM_CORNER_BG[activeStore.platform],
            )}
          />
        </>
      ) : null}
      {showMultiOrgIndicator ? (
        <span
          aria-label={`${otherOrgCount} more organization${otherOrgCount === 1 ? '' : 's'}`}
          className={cn(
            '-bottom-3xs -left-3xs ring-card bg-card text-foreground absolute',
            'text-2xs flex items-center justify-center rounded-sm leading-none font-semibold ring-2',
            'px-3xs py-3xs',
          )}
        >
          {multiOrgLabel}
        </span>
      ) : null}
    </span>
  );
}
