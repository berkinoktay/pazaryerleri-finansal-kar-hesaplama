'use client';

import { Settings02Icon, Tick01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Link } from '@/i18n/navigation';
import { useIsMounted } from '@/lib/use-is-mounted';
import { getOrgAvatarPalette, type OrgAvatarPalette } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import type { Organization, OrgRole, Store, SyncState } from './org-store-switcher';

interface OrgStoreSwitcherListProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
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

const ROLE_KEY: Record<OrgRole, 'roleOwner' | 'roleAdmin' | 'roleMember' | 'roleViewer'> = {
  OWNER: 'roleOwner',
  ADMIN: 'roleAdmin',
  MEMBER: 'roleMember',
  VIEWER: 'roleViewer',
};

const ROLE_TONE: Record<OrgRole, NonNullable<BadgeProps['tone']>> = {
  OWNER: 'primary',
  ADMIN: 'neutral',
  MEMBER: 'outline',
  VIEWER: 'outline',
};

/** When the user belongs to this many orgs the dropdown splits into a
 * "Son Kullanılan" pinned section + a scrollable "Tüm Organizasyonlar"
 * tail. Below the threshold a single section is enough — splitting
 * 4 items adds visual noise without payoff. */
const RECENT_SPLIT_THRESHOLD = 5;
/** How many recent orgs to pin at the top once the split threshold trips. */
const RECENT_TAKE = 3;

interface OrgListSplit {
  recent: Organization[];
  rest: Organization[];
}

/**
 * Decide whether to split the org list into Recent + All sections.
 *
 * Below the threshold, return everything in `rest` (so the renderer
 * draws a single section). Above it, sort by `lastAccessedAt DESC`
 * (nulls last, ties broken by name ASC for stability), pin the top N,
 * and put the remainder in `rest` keeping the API's existing
 * alphabetical order.
 */
function splitRecent(orgs: Organization[]): OrgListSplit {
  if (orgs.length < RECENT_SPLIT_THRESHOLD) return { recent: [], rest: orgs };
  const sorted = [...orgs].sort((a, b) => {
    const aT = a.lastAccessedAt ? Date.parse(a.lastAccessedAt) : 0;
    const bT = b.lastAccessedAt ? Date.parse(b.lastAccessedAt) : 0;
    if (aT !== bT) return bT - aT;
    return a.name.localeCompare(b.name, 'tr');
  });
  const recentRaw = sorted.slice(0, RECENT_TAKE).filter((o) => o.lastAccessedAt !== null);
  const recentIds = new Set(recentRaw.map((o) => o.id));
  return { recent: recentRaw, rest: orgs.filter((o) => !recentIds.has(o.id)) };
}

/**
 * Inner list rendered inside the switcher's popover panel.
 *
 * Tight, information-dense layout: 28px avatars, text-xs primary names,
 * text-2xs muted meta. The hierarchy is driven by typography weight, not
 * background saturation — active rows are a subtle bg-muted plus a check
 * icon, never a heavy primary fill. The footer is three Button primitives
 * sharing one height (h-8) so the visual hierarchy is "primary CTA on the
 * right" rather than "huge button next to text links".
 *
 * Search input height is overridden to h-8 / text-xs so the popover
 * header doesn't dominate the panel — the previous shadcn default
 * (h-11 text-sm) was sized for full-page command palettes, not this
 * compact 384px dropdown.
 */
export function OrgStoreSwitcherList({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
}: OrgStoreSwitcherListProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const formatter = useFormatter();
  const mounted = useIsMounted();
  const split = React.useMemo(() => splitRecent(orgs), [orgs]);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;

  return (
    <div className="flex flex-col">
      <Command className="rounded-none">
        <CommandInput
          placeholder={t('search')}
          className="placeholder:text-muted-foreground h-8 text-xs"
        />
        <CommandList className="max-h-80">
          <CommandEmpty className="py-md text-muted-foreground text-2xs text-center">
            {t('emptyDescription')}
          </CommandEmpty>

          {split.recent.length > 0 ? (
            <>
              <SectionHeading
                label={t('recentSection')}
                count={split.recent.length}
                actionHref="/onboarding/create-organization"
                actionLabel={t('newOrgInline')}
              />
              <CommandGroup heading="" className="px-2xs pb-2xs pt-0">
                {split.recent.map((org) => (
                  <OrgRow
                    key={org.id}
                    org={org}
                    isActive={org.id === activeOrgId}
                    onSelect={onSelectOrg}
                    formatter={formatter}
                    mounted={mounted}
                    t={t}
                  />
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {split.rest.length > 0 ? (
            <>
              <SectionHeading
                label={split.recent.length > 0 ? t('allOrgsSection') : t('sectionOrgs')}
                count={split.rest.length}
                actionHref={split.recent.length === 0 ? '/onboarding/create-organization' : null}
                actionLabel={split.recent.length === 0 ? t('newOrgInline') : null}
              />
              <CommandGroup heading="" className="px-2xs pb-2xs pt-0">
                {split.rest.map((org) => (
                  <OrgRow
                    key={org.id}
                    org={org}
                    isActive={org.id === activeOrgId}
                    onSelect={onSelectOrg}
                    formatter={formatter}
                    mounted={mounted}
                    t={t}
                  />
                ))}
              </CommandGroup>
            </>
          ) : null}

          {stores.length > 0 ? (
            <>
              <CommandSeparator />
              <SectionHeading
                label={activeOrg ? `${t('sectionStores')} — ${activeOrg.name}` : t('sectionStores')}
                count={stores.length}
                actionHref={activeOrg ? '/settings/stores' : null}
                actionLabel={activeOrg ? t('connectStore') : null}
              />
              <CommandGroup heading="" className="px-2xs pb-2xs pt-0">
                {stores.map((store) => (
                  <StoreRow
                    key={store.id}
                    store={store}
                    isActive={store.id === activeStoreId}
                    onSelect={onSelectStore}
                    formatter={formatter}
                    mounted={mounted}
                    t={t}
                  />
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>

      <div className="border-border gap-2xs p-2xs flex items-center border-t">
        <Button asChild variant="ghost" size="sm" className="flex-1">
          <Link href="/settings/organization">{t('footerOrgSettings')}</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="flex-1">
          <Link href="/settings/stores">{t('footerStoreManagement')}</Link>
        </Button>
        <Button asChild variant="default" size="sm" className="flex-1">
          <Link href="/onboarding/create-organization">{t('footerNewOrg')}</Link>
        </Button>
      </div>
    </div>
  );
}

interface SectionHeadingProps {
  label: string;
  count: number;
  actionHref: string | null;
  actionLabel: string | null;
}

/**
 * Section heading mirroring cmdk's auto-rendered group heading typography
 * but with a quiet inline CTA on the right (e.g. "+ Yeni" / "+ Bağla").
 * cmdk's `CommandGroup heading` prop only takes a string — to render a
 * link next to the label we hide cmdk's heading slot (pass empty string)
 * and render this row above the group. Inline CTA is text-only with the
 * primary color, NOT a button — this is a quiet affordance, not an
 * action that should compete with the footer's primary CTA.
 */
function SectionHeading({
  label,
  count,
  actionHref,
  actionLabel,
}: SectionHeadingProps): React.ReactElement {
  return (
    <div className="text-muted-foreground gap-xs px-sm pt-sm pb-2xs text-2xs flex items-center justify-between font-medium tracking-wide uppercase">
      <span className="truncate">
        {label} <span className="text-muted-foreground/70 normal-case">({count})</span>
      </span>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="text-primary hover:text-primary-hover px-3xs py-3xs text-2xs rounded-xs font-medium tracking-normal normal-case"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

interface OrgRowProps {
  org: Organization;
  isActive: boolean;
  onSelect: (id: string) => void;
  formatter: ReturnType<typeof useFormatter>;
  mounted: boolean;
  t: ReturnType<typeof useTranslations<'orgStoreSwitcher'>>;
}

function OrgRow({
  org,
  isActive,
  onSelect,
  formatter,
  mounted,
  t,
}: OrgRowProps): React.ReactElement {
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toUpperCase();
  const meta = formatOrgMeta(org, formatter, mounted, t);

  return (
    <CommandItem
      value={`${org.name} ${org.id}`}
      onSelect={() => onSelect(org.id)}
      className={cn(
        'group/row gap-xs px-2xs py-2xs items-center rounded-sm',
        isActive && 'bg-muted',
      )}
    >
      <Avatar size="sm" className={cn('size-7 rounded-md', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('text-2xs rounded-md font-semibold', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
      <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-foreground truncate text-xs font-medium">{org.name}</span>
        {meta ? <span className="text-muted-foreground text-2xs truncate">{meta}</span> : null}
      </span>
      <Badge tone={ROLE_TONE[org.role]} size="sm" radius="sm" className="shrink-0">
        {t(ROLE_KEY[org.role])}
      </Badge>
      {isActive ? (
        <Tick01Icon className="size-icon-xs text-primary shrink-0" aria-hidden />
      ) : (
        <Link
          href={{ pathname: '/settings/organization' }}
          aria-label={t('orgSettingsLabel', { name: org.name })}
          className="duration-fast hover:bg-card hover:text-foreground text-muted-foreground p-3xs flex shrink-0 items-center justify-center rounded-xs opacity-0 transition-opacity group-hover/row:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Settings02Icon className="size-icon-xs" />
        </Link>
      )}
    </CommandItem>
  );
}

interface StoreRowProps {
  store: Store;
  isActive: boolean;
  onSelect: (id: string) => void;
  formatter: ReturnType<typeof useFormatter>;
  mounted: boolean;
  t: ReturnType<typeof useTranslations<'orgStoreSwitcher'>>;
}

function StoreRow({
  store,
  isActive,
  onSelect,
  formatter,
  mounted,
  t,
}: StoreRowProps): React.ReactElement {
  const meta = formatStoreSyncMeta(store, formatter, mounted, t);

  return (
    <CommandItem
      value={`${store.name} ${store.id}`}
      onSelect={() => onSelect(store.id)}
      className={cn(
        'group/row gap-xs px-2xs py-2xs items-center rounded-sm',
        isActive && 'bg-muted',
      )}
    >
      <span
        aria-hidden
        className="bg-card border-border inline-flex size-7 shrink-0 items-center justify-center rounded-md border"
      >
        <MarketplaceLogo platform={store.platform} size="xs" alt="" />
      </span>
      <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-foreground truncate text-xs font-medium">{store.name}</span>
        <span className="text-muted-foreground gap-3xs text-2xs flex items-center truncate">
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full', SYNC_BG[store.syncState])}
          />
          <span className="truncate">{meta}</span>
        </span>
      </span>
      {isActive ? <Tick01Icon className="size-icon-xs text-primary shrink-0" aria-hidden /> : null}
    </CommandItem>
  );
}

function formatOrgMeta(
  org: Organization,
  formatter: ReturnType<typeof useFormatter>,
  mounted: boolean,
  t: ReturnType<typeof useTranslations<'orgStoreSwitcher'>>,
): string {
  if (org.storeCount === 0) return t('orgMetaNoStores');
  const stores = t('orgMetaStores', { count: org.storeCount });
  if (org.lastSyncedAt === null) return stores;
  const date = new Date(org.lastSyncedAt);
  const time = mounted ? formatter.relativeTime(date) : formatter.dateTime(date, 'date');
  return t('orgMetaWithSync', { stores, time });
}

function formatStoreSyncMeta(
  store: Store,
  formatter: ReturnType<typeof useFormatter>,
  mounted: boolean,
  t: ReturnType<typeof useTranslations<'orgStoreSwitcher'>>,
): string {
  if (store.lastSyncedAt === null) return t('storeNoSync');
  const date = new Date(store.lastSyncedAt);
  const time = mounted ? formatter.relativeTime(date) : formatter.dateTime(date, 'date');
  return t('storeSyncRelative', { time });
}

/**
 * Replaces the list when no orgs exist for the current user.  Two CTAs:
 * primary (create new) and secondary (join via invite).  Both are
 * locale-aware Next links — the routes may not exist yet at build time
 * for every flavor of installation; if so the future feature task
 * connects them.  A 404 here is a known stub during the rollout.
 */
export function OrgStoreSwitcherEmpty(): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  return (
    <div className="gap-sm p-md flex flex-col">
      <div className="gap-3xs flex flex-col">
        <h3 className="text-foreground text-sm font-semibold">{t('emptyTitle')}</h3>
        <p className="text-muted-foreground text-2xs leading-snug">{t('emptyDescription')}</p>
      </div>
      <div className="gap-2xs flex flex-col">
        <Button asChild variant="default" size="sm">
          <Link href="/onboarding/create-organization">{t('emptyCreate')}</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/onboarding/join-organization">{t('emptyJoinInvite')}</Link>
        </Button>
      </div>
    </div>
  );
}
