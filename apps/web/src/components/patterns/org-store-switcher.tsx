'use client';

import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

/**
 * Solid background utility per palette name.  Solid (not gradient) by
 * design: the system's token discipline bans raw oklch in component code,
 * and a flat fill reads identically across light/dark themes because
 * each `--{tone}` token is theme-aware.  Foreground class is paired so
 * the initial letter clears AA contrast.
 */
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
 * Combined org+store switcher chip with layered popover dropdown.
 *
 * Single trigger surfaces both axes of context (which organization +
 * which marketplace store) so the user never has to step through two
 * separate menus.  Expanded mode renders a 32px avatar with platform
 * corner badge + sync pulse + dual-line names; collapsed mode collapses
 * to an icon-only avatar but keeps the corner badges.  The dropdown
 * uses the cmdk-based Command primitive for fuzzy search across both
 * sections.  Empty state (no orgs) replaces the list with two CTAs.
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

  const triggerLabel = activeOrg
    ? activeStore
      ? `${activeOrg.name} · ${activeStore.name}`
      : activeOrg.name
    : t('emptyCreate');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className={cn(
            'duration-fast flex items-center rounded-sm transition-colors',
            'bg-muted hover:bg-accent',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            collapsed
              ? 'size-xl justify-center p-0 pointer-coarse:size-11'
              : 'gap-xs px-xs py-3xs w-full',
          )}
        >
          {activeOrg ? (
            <OrgAvatarWithBadges org={activeOrg} activeStore={activeStore} />
          ) : (
            <span
              aria-hidden
              className="bg-muted-foreground/20 text-foreground size-xl flex shrink-0 items-center justify-center rounded-sm"
            >
              <PlusSignIcon className="size-icon-sm" />
            </span>
          )}
          {!collapsed ? (
            <>
              <span className="gap-3xs flex min-w-0 flex-1 flex-col items-start overflow-hidden">
                <span className="text-foreground w-full truncate text-left text-sm font-medium">
                  {activeOrg?.name ?? t('emptyCreate')}
                </span>
                {activeStore ? (
                  <span className="text-muted-foreground gap-3xs text-2xs flex w-full items-center truncate text-left">
                    <span
                      aria-hidden
                      className={cn(
                        'size-2xs shrink-0 rounded-full',
                        SYNC_BG[activeStore.syncState],
                      )}
                    />
                    <span className="truncate">{activeStore.name}</span>
                  </span>
                ) : null}
              </span>
              <ArrowDown01Icon
                className="size-icon-xs text-muted-foreground shrink-0"
                aria-hidden
              />
            </>
          ) : null}
        </button>
      </PopoverTrigger>
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
}

/**
 * 32px avatar tile with two corner badges:
 *  - platform mark (sağ-alt) — the active store's marketplace logo,
 *    ringed in `bg-card` to read clearly over the colored avatar.
 *  - sync pulse (sol-üst) — 8px circle whose tint matches the active
 *    store's sync state.
 *
 * Solid palette background (not gradient) per token discipline — raw
 * oklch values are banned in component code; the 6 semantic tokens
 * already cover both modes via theme variables.
 */
function OrgAvatarWithBadges({ org, activeStore }: OrgAvatarWithBadgesProps): React.ReactElement {
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toUpperCase();

  return (
    <span className="relative shrink-0">
      <Avatar size="sm" className={cn('rounded-sm', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-sm font-semibold', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
      {activeStore ? (
        <>
          <span
            aria-hidden
            className={cn(
              'top-3xs left-3xs ring-card size-2xs absolute rounded-full ring-2',
              SYNC_BG[activeStore.syncState],
            )}
          />
          <span
            aria-hidden
            className="-bottom-3xs -right-3xs ring-card bg-card p-3xs absolute flex items-center justify-center rounded-full ring-2"
          >
            <MarketplaceLogo platform={activeStore.platform} size="sm" alt="" />
          </span>
        </>
      ) : null}
    </span>
  );
}
