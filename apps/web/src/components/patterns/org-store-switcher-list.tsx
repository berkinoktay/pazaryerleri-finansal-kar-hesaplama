'use client';

import { useCommandState } from 'cmdk';
import { ArrowRight01Icon, Settings02Icon, ShoppingBag01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { IdentityCell } from '@/components/patterns/identity-cell';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot, type StatusDotProps } from '@/components/ui/status-dot';
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
  /** When provided, the Stores header's "+ Yeni Mağaza" runs this (opens the
   * connect-store modal) instead of linking to the settings page. */
  onAddStore?: () => void;
}

const PALETTE_BG: Record<OrgAvatarPalette, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
};

const SYNC_TONE: Record<SyncState, StatusDotProps['tone']> = {
  fresh: 'success',
  stale: 'warning',
  failed: 'destructive',
};

const ROLE_KEY: Record<OrgRole, 'roleOwner' | 'roleAdmin' | 'roleMember' | 'roleViewer'> = {
  OWNER: 'roleOwner',
  ADMIN: 'roleAdmin',
  MEMBER: 'roleMember',
  VIEWER: 'roleViewer',
};

// Restrained role vocabulary for a dense list: OWNER gets a quiet brand-tinted
// SURFACE chip (not a loud solid fill that shouts in every row); ADMIN a neutral
// surface; MEMBER/VIEWER the lightest outline. The role is context, not an alarm.
const ROLE_BADGE: Record<OrgRole, { tone: BadgeProps['tone']; variant?: BadgeProps['variant'] }> = {
  OWNER: { tone: 'primary', variant: 'surface' },
  ADMIN: { tone: 'neutral', variant: 'surface' },
  MEMBER: { tone: 'neutral', variant: 'outline' },
  VIEWER: { tone: 'neutral', variant: 'outline' },
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
 *
 * @useWhen rendering the inner picker body for OrgStoreSwitcher (recent / all / stores sections, role badges, search, highlighting) — this is OrgStoreSwitcher's render delegate, not a standalone primitive
 */
export function OrgStoreSwitcherList({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  onAddStore,
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
                // When the recent section is rendered above, it already carries
                // the create CTA — repeating it on the "all orgs" header is noise.
                createAction={
                  split.recent.length === 0
                    ? {
                        href: '/onboarding/create-organization',
                        label: t('newOrgInline'),
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
                  activeOrg
                    ? onAddStore
                      ? { label: t('connectStore'), onClick: onAddStore }
                      : { href: '/settings/stores', label: t('connectStore') }
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

      {/* Management footer — a clear, always-visible home for org + store
          settings. Replaces the cramped per-section ⚙ icons (which also linked
          a non-existent /settings/organization route): one obvious row each,
          full label + trailing chevron, so "where do I manage this?" is answered
          at a glance rather than hidden behind a tiny icon. */}
      <div className="border-border gap-3xs p-2xs flex flex-col border-t">
        <ManageRow href="/settings" icon={Settings02Icon} label={t('footerOrgSettings')} />
        <ManageRow
          href="/settings/stores"
          icon={ShoppingBag01Icon}
          label={t('footerStoreManagement')}
        />
      </div>
    </div>
  );
}

interface ManageRowProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

/** A clear management destination row in the switcher footer (icon + label +
 * trailing chevron). Navigating closes the popover via the route change. */
function ManageRow({ href, icon: Icon, label }: ManageRowProps): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'gap-xs px-2xs py-2xs duration-fast flex cursor-pointer items-center rounded-sm text-xs transition-colors',
        'text-muted-foreground hover:bg-muted hover:text-foreground',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
      )}
    >
      <Icon className="size-icon-sm" />
      <span className="flex-1">{label}</span>
      <ArrowRight01Icon className="size-icon-xs text-muted-foreground-dim" aria-hidden />
    </Link>
  );
}

interface SectionCreateAction {
  label: string;
  /** Navigate to a page (e.g. /onboarding/create-organization)… */
  href?: string;
  /** …or run an action in place (e.g. open the connect-store modal). */
  onClick?: () => void;
}

interface SectionHeadingProps {
  label: string;
  count: number;
  /** Quiet text CTA on the right (e.g. "+ Yeni Organizasyon"). Renders a Link when `href` is set, a button when `onClick` is. */
  createAction: SectionCreateAction | null;
}

// Quiet brand text CTA — shared by the Link and button forms so the create
// affordance looks identical whether it navigates or opens a modal. `whitespace-nowrap`
// keeps it on one line so a long section label truncates instead of pushing it to wrap.
const CREATE_ACTION_CLASS = cn(
  'text-primary hover:text-primary-hover px-2xs py-3xs text-2xs rounded-xs font-medium tracking-normal normal-case whitespace-nowrap cursor-pointer',
  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
);

/**
 * Section heading mirroring cmdk's auto-rendered group heading typography
 * with a single inline create CTA ("+ Yeni X") on the right. Management
 * destinations live in the dropdown's footer (one clear row each) rather than
 * as a cramped per-section ⚙ icon.
 */
function SectionHeading({ label, count, createAction }: SectionHeadingProps): React.ReactElement {
  return (
    <div className="text-muted-foreground gap-xs px-sm pt-sm pb-2xs text-2xs flex items-center justify-between font-medium tracking-wide uppercase">
      <span className="min-w-0 truncate">
        {label} <span className="text-muted-foreground-dim normal-case">({count})</span>
      </span>
      <div className="gap-2xs flex shrink-0 items-center">
        {createAction !== null ? <CreateAction action={createAction} /> : null}
      </div>
    </div>
  );
}

function CreateAction({ action }: { action: SectionCreateAction }): React.ReactElement | null {
  if (action.onClick !== undefined) {
    return (
      <button type="button" onClick={action.onClick} className={CREATE_ACTION_CLASS}>
        {action.label}
      </button>
    );
  }
  if (action.href !== undefined) {
    return (
      <Link href={action.href} className={CREATE_ACTION_CLASS}>
        {action.label}
      </Link>
    );
  }
  return null;
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
      // Persisted active selection — announced to screen readers (the radio
      // ActiveDot is visual-only; cmdk's aria-selected only tracks keyboard
      // highlight, not which org is actually active).
      aria-current={isActive ? 'true' : undefined}
      className={cn('group/row px-2xs py-2xs rounded-sm', isActive && 'bg-muted')}
    >
      <IdentityCell
        className="w-full"
        leading={
          <Avatar size="sm" className={cn('size-7 rounded-md', PALETTE_BG[palette])}>
            <AvatarFallback className={cn('rounded-md', PALETTE_BG[palette])}>
              {initial}
            </AvatarFallback>
          </Avatar>
        }
        title={<HighlightedText text={org.name} />}
        meta={meta ? <span className="truncate">{meta}</span> : undefined}
        trailing={
          <span className="gap-xs flex shrink-0 items-center">
            <Badge
              tone={ROLE_BADGE[org.role].tone}
              variant={ROLE_BADGE[org.role].variant}
              size="sm"
              radius="sm"
            >
              {t(ROLE_KEY[org.role])}
            </Badge>
            {isActive ? <ActiveDot /> : null}
          </span>
        }
      />
      {/* Announce the persistently-active org to screen readers independent of
          how a given SR treats aria-current on a role=option (cmdk owns
          aria-selected for keyboard highlight, so it can't carry this). */}
      {isActive ? <span className="sr-only">{t('activeLabel')}</span> : null}
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
      aria-current={isActive ? 'true' : undefined}
      className={cn('group/row px-2xs py-2xs rounded-sm', isActive && 'bg-muted')}
    >
      <IdentityCell
        className="w-full"
        leading={
          <span
            aria-hidden
            className="bg-card border-border inline-flex size-7 shrink-0 items-center justify-center rounded-md border"
          >
            <MarketplaceLogo platform={store.platform} size="xs" alt="" />
          </span>
        }
        title={<HighlightedText text={store.name} />}
        meta={
          <>
            <StatusDot tone={SYNC_TONE[store.syncState]} animatePulse />
            <span className="truncate">{meta}</span>
          </>
        }
        trailing={isActive ? <ActiveDot /> : undefined}
      />
      {isActive ? <span className="sr-only">{t('activeLabel')}</span> : null}
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
