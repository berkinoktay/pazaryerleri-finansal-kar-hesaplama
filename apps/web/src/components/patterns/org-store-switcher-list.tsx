'use client';

import { useCommandState } from 'cmdk';
import { Settings02Icon, ShoppingBag01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

type Platform = Store['platform'];

const PLATFORM_KEY: Record<Platform, 'platformTRENDYOL' | 'platformHEPSIBURADA'> = {
  TRENDYOL: 'platformTRENDYOL',
  HEPSIBURADA: 'platformHEPSIBURADA',
};

/** Escape regex metacharacters so user input can be embedded in `new RegExp`
 * for substring highlighting without crashing on `.`, `*`, `(`, etc. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Below this combined item count the search input is hidden — for a
 * single org + single store the input is pure noise. Threshold matches
 * the HTML reference spec's "minimal mode" rule. */
const SEARCH_VISIBLE_THRESHOLD = 3;

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

  const showSearch = orgs.length + stores.length >= SEARCH_VISIBLE_THRESHOLD;

  return (
    <div className="flex flex-col">
      <Command className="rounded-none">
        {showSearch ? (
          <CommandInput
            placeholder={t('search')}
            // Inner input loses h-11 (full-page command palette default)
            // and bg/padding so the wrapper's geometry drives layout.
            // Mirrors `<Input size="sm" leadingIcon={...}>` from the
            // primitives showcase: h-8 wrapper, gap-xs, px-sm, full
            // border + focus-within ring change.
            className="h-full px-0 py-0 text-xs"
            wrapperClassName={cn(
              'm-2xs h-8 gap-xs px-sm border-b-0',
              'border border-border rounded-sm bg-background shadow-xs',
              'hover:border-border-strong focus-within:border-ring',
              'duration-fast transition-colors',
            )}
          />
        ) : null}
        <CommandList className="max-h-80">
          <CommandEmpty className="py-md text-muted-foreground text-2xs text-center">
            {t('emptyDescription')}
          </CommandEmpty>

          {split.recent.length > 0 ? (
            <>
              <SectionHeading
                label={t('recentSection')}
                count={split.recent.length}
                createAction={{
                  href: '/onboarding/create-organization',
                  label: t('newOrgInline'),
                }}
                manageAction={{
                  href: '/settings/organization',
                  label: t('footerOrgSettings'),
                  icon: Settings02Icon,
                }}
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
                // When the recent section is rendered above, it already
                // surfaces both create + manage actions — repeating them
                // on the "all orgs" header would be visual noise.
                createAction={
                  split.recent.length === 0
                    ? {
                        href: '/onboarding/create-organization',
                        label: t('newOrgInline'),
                      }
                    : null
                }
                manageAction={
                  split.recent.length === 0
                    ? {
                        href: '/settings/organization',
                        label: t('footerOrgSettings'),
                        icon: Settings02Icon,
                      }
                    : null
                }
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
                createAction={
                  activeOrg ? { href: '/settings/stores', label: t('connectStore') } : null
                }
                manageAction={
                  activeOrg
                    ? {
                        href: '/settings/stores',
                        label: t('footerStoreManagement'),
                        icon: ShoppingBag01Icon,
                      }
                    : null
                }
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
    </div>
  );
}

interface SectionAction {
  href: string;
  label: string;
}

interface SectionManageAction extends SectionAction {
  icon: React.ComponentType<{ className?: string }>;
}

interface SectionHeadingProps {
  label: string;
  count: number;
  /** Quiet text-link CTA on the right (e.g. "+ Yeni Organizasyon"). */
  createAction: SectionAction | null;
  /** Icon-only secondary action (e.g. ⚙ org settings) with tooltip. */
  manageAction: SectionManageAction | null;
}

/**
 * Section heading mirroring cmdk's auto-rendered group heading typography
 * with up to two inline actions on the right: a primary text link for
 * creation ("+ Yeni X") and a secondary icon link for management (⚙).
 * Both live inside the section so each group carries its own affordances —
 * the dropdown no longer needs a separate footer (Image #8 follow-up).
 */
function SectionHeading({
  label,
  count,
  createAction,
  manageAction,
}: SectionHeadingProps): React.ReactElement {
  return (
    <div className="text-muted-foreground gap-xs px-sm pt-sm pb-2xs text-2xs flex items-center justify-between font-medium tracking-wide uppercase">
      <span className="truncate">
        {label} <span className="text-muted-foreground/70 normal-case">({count})</span>
      </span>
      <div className="gap-2xs flex items-center">
        {createAction ? (
          <Link
            href={createAction.href}
            className="text-primary hover:text-primary-hover px-2xs py-3xs text-2xs rounded-xs font-medium tracking-normal normal-case"
          >
            {createAction.label}
          </Link>
        ) : null}
        {manageAction ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={manageAction.href}
                aria-label={manageAction.label}
                className="text-muted-foreground hover:text-foreground hover:bg-muted p-2xs duration-fast flex items-center justify-center rounded-sm transition-colors"
              >
                <manageAction.icon className="size-icon-xs" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top">{manageAction.label}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Active-row indicator. Renders as a radio-button-style dot (outer ring +
 * inner filled dot) instead of a check icon — radio semantics are a
 * better fit for the switcher's "exactly one selected at a time" model.
 */
function ActiveDot(): React.ReactElement {
  return (
    <span
      aria-hidden
      className="border-primary size-icon-sm flex shrink-0 items-center justify-center rounded-full border-2"
    >
      <span className="bg-primary size-1.5 rounded-full" />
    </span>
  );
}

/**
 * Highlight matched substrings of `text` against the current cmdk search
 * query. Reads `state.search` via `useCommandState` so any row can render
 * its own highlight without prop-drilling the query down from the list.
 *
 * Splits on a case-insensitive regex of the escaped query, wraps matched
 * fragments in <mark> with a warning-tinted bg. When the query is empty
 * the original text is returned verbatim — no DOM cost.
 */
function HighlightedText({ text }: { text: string }): React.ReactElement {
  const query = useCommandState((state) => state.search) as string;
  if (!query) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        part && re.test(part) && part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-warning/25 text-foreground px-3xs rounded-xs">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
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
        <span className="text-foreground truncate text-xs font-medium">
          <HighlightedText text={org.name} />
        </span>
        {meta ? <span className="text-muted-foreground text-2xs truncate">{meta}</span> : null}
      </span>
      <Badge tone={ROLE_TONE[org.role]} size="sm" radius="sm" className="shrink-0">
        {t(ROLE_KEY[org.role])}
      </Badge>
      {isActive ? (
        <ActiveDot />
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
      value={`${store.name} ${store.id} ${t(PLATFORM_KEY[store.platform])}`}
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
        <span className="text-foreground truncate text-xs font-medium">
          <HighlightedText text={store.name} />
        </span>
        <span className="text-muted-foreground gap-3xs text-2xs flex items-center truncate">
          <span
            aria-hidden
            className={cn(
              'animate-sync-pulse size-2 shrink-0 rounded-full',
              SYNC_BG[store.syncState],
            )}
          />
          <span className="truncate">{meta}</span>
        </span>
      </span>
      {isActive ? <ActiveDot /> : null}
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
  const platform = t(PLATFORM_KEY[store.platform]);
  const sync =
    store.lastSyncedAt === null
      ? t('storeNoSync')
      : t('storeSyncRelative', {
          time: mounted
            ? formatter.relativeTime(new Date(store.lastSyncedAt))
            : formatter.dateTime(new Date(store.lastSyncedAt), 'date'),
        });
  return t('storeMetaWithPlatform', { platform, sync });
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
