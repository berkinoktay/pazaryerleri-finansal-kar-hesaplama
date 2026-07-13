'use client';

import { ArrowRight01Icon, Settings02Icon, ShoppingBag01Icon, Tick02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { getOrgAvatarPalette, PALETTE_BG } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import type { Organization, OrgRole, Store, UsePreviewStores } from './org-store-switcher';

type Platform = Store['platform'];

const PLATFORM_KEY: Record<Platform, 'platformTRENDYOL' | 'platformHEPSIBURADA'> = {
  TRENDYOL: 'platformTRENDYOL',
  HEPSIBURADA: 'platformHEPSIBURADA',
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

// Quiet brand text CTA — shared by the Link and button forms so the create
// affordance looks identical whether it navigates or opens a modal. `whitespace-nowrap`
// keeps it on one line so a long section label truncates instead of pushing it to wrap.
const CREATE_ACTION_CLASS = cn(
  'text-primary hover:text-primary-hover px-2xs py-3xs text-2xs rounded-xs font-medium tracking-normal normal-case whitespace-nowrap cursor-pointer',
  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
);

// Per-context store-row sizing. `panes` (desktop) is dense; `stacked` (mobile
// drawer) grows the touch targets, plate, and name so a finger can hit a row.
const STORE_ROW_STYLE = {
  panes: {
    // pointer-coarse:min-h-11 — a tablet (wide viewport, coarse pointer) uses
    // the dense panes layout, so bump the row to a 44px finger target there.
    row: 'gap-xs px-2xs py-2xs rounded-sm pointer-coarse:min-h-11',
    plate: 'size-7',
    logo: 'xs',
    name: 'text-xs',
  },
  stacked: {
    row: 'gap-sm min-h-11 px-sm rounded-md',
    plate: 'size-9',
    logo: 'sm',
    name: 'text-sm',
  },
} as const satisfies Record<
  'panes' | 'stacked',
  { row: string; plate: string; logo: 'xs' | 'sm'; name: string }
>;

export interface OrgStoreSwitcherPanelProps {
  orgs: Organization[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  /** Stores of the ACTIVE org, already loaded by the shell's owner. */
  activeOrgStores: Store[];
  layout: 'panes' | 'stacked';
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
  onSelectScope: (orgId: string, storeId: string, storeName: string) => void;
  onAddStore?: () => void;
  /** Injected adapter that previews a non-active org's stores (feature-owned). */
  usePreviewStores: UsePreviewStores;
  /** Close the hosting shell (popover/dialog/drawer). */
  onRequestClose: () => void;
}

/**
 * The switcher's picker body — a two-pane org+store selector rendered inside
 * whatever shell the trigger mounts (popover on desktop, dialog when the rail
 * is collapsed, drawer on mobile).
 *
 * Preview model: selecting an org row/chip only PREVIEWS it — the store list
 * on the right re-targets that org without committing the scope. Picking a
 * store commits: same org → `onSelectStore`, a different org → `onSelectScope`
 * (org + store in one jump). This lets the user browse another org's stores
 * before deciding, instead of switching first and discovering later.
 *
 * @useWhen rendering the org/store picker body inside OrgStoreSwitcher's shell (panes layout for popover/dialog, stacked for the mobile drawer)
 */
export function OrgStoreSwitcherPanel({
  orgs,
  activeOrgId,
  activeStoreId,
  activeOrgStores,
  layout,
  onSelectOrg,
  onSelectStore,
  onSelectScope,
  onAddStore,
  usePreviewStores,
  onRequestClose,
}: OrgStoreSwitcherPanelProps): React.ReactElement {
  const [previewOrgId, setPreviewOrgId] = React.useState<string | null>(
    activeOrgId ?? orgs[0]?.id ?? null,
  );

  const previewIsActiveOrg = previewOrgId !== null && previewOrgId === activeOrgId;
  // Only a non-active previewed org needs a fetch — the active org's stores are
  // already hydrated. Passing `null` disables the injected query (see useStores).
  const remoteOrgId = previewOrgId !== null && !previewIsActiveOrg ? previewOrgId : null;
  const preview = usePreviewStores(remoteOrgId);

  const previewStores: Store[] = previewIsActiveOrg ? activeOrgStores : preview.stores;
  const isLoadingStores = remoteOrgId !== null && preview.isLoading;
  const isStoresError = remoteOrgId !== null && preview.isError;

  function handleSelectStore(store: Store): void {
    // Re-selecting the already-active store is a plain close — no switch.
    if (previewIsActiveOrg && store.id === activeStoreId) {
      onRequestClose();
      return;
    }
    if (previewOrgId === activeOrgId) {
      onSelectStore(store.id);
    } else if (previewOrgId !== null) {
      onSelectScope(previewOrgId, store.id, store.name);
    }
    onRequestClose();
  }

  function handleSwitchToOrg(orgId: string): void {
    onSelectOrg(orgId);
    onRequestClose();
  }

  const storeBody = (
    <StoreListBody
      variant={layout}
      stores={previewStores}
      activeStoreId={previewIsActiveOrg ? activeStoreId : null}
      isLoading={isLoadingStores}
      isError={isStoresError}
      previewIsActiveOrg={previewIsActiveOrg}
      previewOrgId={previewOrgId}
      onSelectStore={handleSelectStore}
      onSwitchToOrg={handleSwitchToOrg}
      onAddStore={onAddStore}
      onRequestClose={onRequestClose}
    />
  );

  if (layout === 'stacked') {
    return (
      <StackedPanel
        orgs={orgs}
        activeOrgId={activeOrgId}
        previewOrgId={previewOrgId}
        onPreviewOrg={setPreviewOrgId}
        storeCount={isLoadingStores ? null : previewStores.length}
        onAddStore={onAddStore}
        onRequestClose={onRequestClose}
      >
        {storeBody}
      </StackedPanel>
    );
  }

  // Single org — no picker needed, render only the store pane full-width.
  if (orgs.length <= 1) {
    return (
      <div className="flex flex-col">
        <StoreHeader
          count={isLoadingStores ? null : previewStores.length}
          onAddStore={onAddStore}
          onRequestClose={onRequestClose}
        />
        {storeBody}
        <PanelFooter withShortcut />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[var(--spacing-switcher-orgpane)_minmax(0,1fr)]">
      <div className="border-border bg-popover flex flex-col border-r">
        <OrgPaneHeader />
        <div className="gap-3xs p-2xs flex max-h-80 flex-col overflow-y-auto">
          {orgs.map((org) => (
            <OrgPaneRow
              key={org.id}
              org={org}
              isPreview={org.id === previewOrgId}
              isActive={org.id === activeOrgId}
              onPreview={setPreviewOrgId}
            />
          ))}
        </div>
      </div>
      <div className="bg-surface-subtle flex flex-col">
        <StoreHeader
          count={isLoadingStores ? null : previewStores.length}
          onAddStore={onAddStore}
          onRequestClose={onRequestClose}
        />
        {storeBody}
      </div>
      <PanelFooter className="col-span-2" withShortcut />
    </div>
  );
}

/** Left-pane header: "Organizations" label + a quiet "+ New" org create link. */
function OrgPaneHeader(): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  return (
    <PaneHeading label={t('sectionOrgs')}>
      <Link
        href="/onboarding/create-organization"
        aria-label={t('newOrgInline')}
        className={CREATE_ACTION_CLASS}
      >
        {t('newOrgShort')}
      </Link>
    </PaneHeading>
  );
}

interface OrgPaneRowProps {
  org: Organization;
  isPreview: boolean;
  isActive: boolean;
  onPreview: (orgId: string) => void;
}

/**
 * One org row in the left pane. Clicking PREVIEWS the org (re-targets the store
 * pane) — it never commits the switch. The active org carries `aria-current`
 * plus an sr-only "active" so a screen reader hears which org is live even
 * though the visual cue (preview highlight) tracks a different thing.
 */
function OrgPaneRow({ org, isPreview, isActive, onPreview }: OrgPaneRowProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toLocaleUpperCase('tr');

  return (
    <button
      type="button"
      onClick={() => onPreview(org.id)}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        // pointer-coarse:min-h-11 — 44px finger target on a tablet (coarse
        // pointer at a wide viewport, where this dense pane still renders).
        'gap-xs px-2xs py-2xs duration-fast flex cursor-pointer items-center rounded-sm text-left transition-colors pointer-coarse:min-h-11',
        isPreview ? 'bg-primary-soft' : 'hover:bg-surface-row-hover',
      )}
    >
      <Avatar size="sm" className={cn('size-7 rounded-md', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-md', PALETTE_BG[palette])}>{initial}</AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'flex-1 truncate text-xs font-semibold',
          isPreview && 'text-primary-soft-foreground',
        )}
      >
        {org.name}
      </span>
      <Badge
        tone={ROLE_BADGE[org.role].tone}
        variant={ROLE_BADGE[org.role].variant}
        size="sm"
        radius="sm"
      >
        {t(ROLE_KEY[org.role])}
      </Badge>
      <ArrowRight01Icon className="size-icon-xs text-muted-foreground-dim" aria-hidden />
      {isActive ? <span className="sr-only">{t('activeLabel')}</span> : null}
    </button>
  );
}

interface StoreHeaderProps {
  /** `null` while the previewed org's stores are still loading — renders the
   * countless label so a stale "(0)" never flashes mid-fetch. */
  count: number | null;
  onAddStore?: () => void;
  onRequestClose: () => void;
  className?: string;
}

/** Store-pane header: "Stores (N)" label + a "+ New Store" connect CTA. */
function StoreHeader({
  count,
  onAddStore,
  onRequestClose,
  className,
}: StoreHeaderProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const label = count === null ? t('sectionStores') : t('sectionStoresWithCount', { count });
  return (
    <PaneHeading label={label} className={className}>
      <StoreConnectAction onAddStore={onAddStore} onRequestClose={onRequestClose} />
    </PaneHeading>
  );
}

interface StoreConnectActionProps {
  onAddStore?: () => void;
  onRequestClose: () => void;
}

/**
 * "+ New Store" affordance. When the caller's role grants it (`onAddStore`
 * provided) this closes the shell and opens the connect-store modal; otherwise
 * it links to the store-management settings page.
 */
function StoreConnectAction({
  onAddStore,
  onRequestClose,
}: StoreConnectActionProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  if (onAddStore !== undefined) {
    return (
      <button
        type="button"
        onClick={() => {
          onRequestClose();
          onAddStore();
        }}
        className={CREATE_ACTION_CLASS}
      >
        {t('connectStore')}
      </button>
    );
  }
  return (
    <Link href="/settings/stores" className={CREATE_ACTION_CLASS}>
      {t('connectStore')}
    </Link>
  );
}

interface StoreListBodyProps {
  variant: 'panes' | 'stacked';
  stores: Store[];
  activeStoreId: string | null;
  isLoading: boolean;
  isError: boolean;
  previewIsActiveOrg: boolean;
  previewOrgId: string | null;
  onSelectStore: (store: Store) => void;
  onSwitchToOrg: (orgId: string) => void;
  onAddStore?: () => void;
  onRequestClose: () => void;
}

/**
 * The previewed org's store list, with all four fetch states: loading
 * (skeleton rows), error (one muted line), empty (an org with no stores yet),
 * and the populated list. Empty branches to two CTAs — connect a store when
 * previewing the ACTIVE org, or "switch to this org" for another org.
 */
function StoreListBody({
  variant,
  stores,
  activeStoreId,
  isLoading,
  isError,
  previewIsActiveOrg,
  previewOrgId,
  onSelectStore,
  onSwitchToOrg,
  onAddStore,
  onRequestClose,
}: StoreListBodyProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const style = STORE_ROW_STYLE[variant];
  const listClass = 'gap-3xs p-2xs flex flex-col';

  if (isLoading) {
    return (
      <div className={listClass}>
        {[0, 1].map((i) => (
          <div key={i} className={cn(style.row, 'flex items-center')}>
            <Skeleton className={style.plate} radius="md" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-2xs text-muted-foreground px-sm py-xs">{t('storesLoadError')}</p>;
  }

  if (stores.length === 0) {
    return (
      <div className="gap-xs p-sm flex flex-col items-start">
        <p className="text-2xs text-muted-foreground">{t('storesEmptyInOrg')}</p>
        {previewIsActiveOrg ? (
          <StoreConnectAction onAddStore={onAddStore} onRequestClose={onRequestClose} />
        ) : previewOrgId !== null ? (
          <Button variant="outline" size="sm" onClick={() => onSwitchToOrg(previewOrgId)}>
            {t('switchToOrg')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn(listClass, variant === 'panes' && 'max-h-80 overflow-y-auto')}>
      {stores.map((store) => (
        <StoreRow
          key={store.id}
          store={store}
          variant={variant}
          isActive={store.id === activeStoreId}
          onSelect={onSelectStore}
        />
      ))}
    </div>
  );
}

interface StoreRowProps {
  store: Store;
  variant: 'panes' | 'stacked';
  isActive: boolean;
  onSelect: (store: Store) => void;
}

function StoreRow({ store, variant, isActive, onSelect }: StoreRowProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const style = STORE_ROW_STYLE[variant];
  return (
    <button
      type="button"
      onClick={() => onSelect(store)}
      aria-current={isActive ? 'true' : undefined}
      // Include the marketplace name so a screen reader hears "<store> ·
      // Trendyol" rather than just the store name (the logo is decorative).
      aria-label={`${store.name} · ${t(PLATFORM_KEY[store.platform])}`}
      className={cn(
        'duration-fast hover:bg-surface-row-hover flex cursor-pointer items-center text-left transition-colors',
        style.row,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'bg-card border-border inline-flex shrink-0 items-center justify-center rounded-md border',
          style.plate,
        )}
      >
        <MarketplaceLogo platform={store.platform} size={style.logo} alt="" />
      </span>
      <span className={cn('flex-1 truncate font-semibold', style.name)}>{store.name}</span>
      {isActive ? <ActiveDot /> : null}
    </button>
  );
}

interface StackedPanelProps {
  orgs: Organization[];
  activeOrgId: string | null;
  previewOrgId: string | null;
  onPreviewOrg: (orgId: string) => void;
  /** `null` while the previewed org's stores are still loading — renders the
   * countless label so a stale "(0)" never flashes mid-fetch. */
  storeCount: number | null;
  onAddStore?: () => void;
  onRequestClose: () => void;
  children: React.ReactNode;
}

/**
 * Mobile-drawer layout: a horizontal org-chip strip on top (hidden for a
 * single org), the previewed org's store list, then the management footer. The
 * chip strip fades on its right edge while more chips remain off-screen.
 */
function StackedPanel({
  orgs,
  activeOrgId,
  previewOrgId,
  onPreviewOrg,
  storeCount,
  onAddStore,
  onRequestClose,
  children,
}: StackedPanelProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const chipsRef = React.useRef<HTMLDivElement>(null);
  const atEnd = useScrollAtEnd(chipsRef);
  const showChips = orgs.length > 1;
  const storesLabel =
    storeCount === null ? t('sectionStores') : t('sectionStoresWithCount', { count: storeCount });

  return (
    <div className="pb-sm flex flex-col">
      {showChips ? (
        <>
          <PaneHeading
            label={t('sectionOrgsWithCount', { count: orgs.length })}
            className="px-md"
          />
          <div className="relative">
            <div ref={chipsRef} className="gap-xs px-md pb-xs flex overflow-x-auto">
              {orgs.map((org) => (
                <OrgChip
                  key={org.id}
                  org={org}
                  isPreview={org.id === previewOrgId}
                  isActive={org.id === activeOrgId}
                  onPreview={onPreviewOrg}
                />
              ))}
            </div>
            {!atEnd ? (
              <div className="from-popover pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-l to-transparent" />
            ) : null}
          </div>
        </>
      ) : null}
      <PaneHeading label={storesLabel} className="px-md">
        <StoreConnectAction onAddStore={onAddStore} onRequestClose={onRequestClose} />
      </PaneHeading>
      {children}
      <PanelFooter className="mt-xs" />
    </div>
  );
}

interface OrgChipProps {
  org: Organization;
  isPreview: boolean;
  isActive: boolean;
  onPreview: (orgId: string) => void;
}

/** A pill-shaped org chip in the mobile drawer's horizontal strip. */
function OrgChip({ org, isPreview, isActive, onPreview }: OrgChipProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toLocaleUpperCase('tr');
  return (
    <button
      type="button"
      onClick={() => onPreview(org.id)}
      aria-pressed={isPreview}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'gap-xs px-sm border-border bg-card text-muted-foreground duration-fast flex h-9 shrink-0 cursor-pointer items-center rounded-full border text-xs font-medium shadow-xs transition-colors active:scale-95 pointer-coarse:h-11',
        isPreview &&
          'border-primary bg-primary-soft text-primary-soft-foreground ring-primary font-semibold ring-1',
      )}
    >
      <Avatar size="sm" className={cn('size-6 rounded-full', PALETTE_BG[palette])}>
        <AvatarFallback className={cn('rounded-full', PALETTE_BG[palette])}>
          {initial}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{org.name}</span>
      {isPreview ? <Tick02Icon className="size-icon-xs" aria-hidden /> : null}
      {isActive ? <span className="sr-only">{t('activeLabel')}</span> : null}
    </button>
  );
}

interface PaneHeadingProps {
  label: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Section heading shared by every pane — the muted uppercase micro-label with
 * an optional trailing action (create org / connect store). `px-md` override
 * is passed for the wider mobile drawer.
 */
function PaneHeading({ label, className, children }: PaneHeadingProps): React.ReactElement {
  return (
    <div
      className={cn(
        'text-muted-foreground text-2xs px-sm pt-sm pb-2xs gap-xs flex items-center justify-between font-medium tracking-wide uppercase',
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {children}
    </div>
  );
}

interface PanelFooterProps {
  className?: string;
  /** Show the ⌘O shortcut hint (desktop only). */
  withShortcut?: boolean;
}

/**
 * Management footer shared by both layouts: clear destinations for org + store
 * settings, plus the ⌘O shortcut hint on desktop.
 */
function PanelFooter({ className, withShortcut = false }: PanelFooterProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  return (
    <div
      className={cn(
        'border-border gap-3xs p-2xs flex border-t',
        // Row: inline destinations + a right-aligned ⌘O hint (desktop). Column:
        // full-width stacked rows (mobile) — no items-center, so they stretch.
        withShortcut ? 'flex-row items-center' : 'flex-col',
        className,
      )}
    >
      <ManageRow href="/settings" icon={Settings02Icon} label={t('footerOrgSettings')} />
      <ManageRow
        href="/settings/stores"
        icon={ShoppingBag01Icon}
        label={t('footerStoreManagement')}
      />
      {withShortcut ? (
        <KbdGroup aria-label={t('openShortcut')} className="ml-auto">
          <Kbd>⌘</Kbd>
          <Kbd>O</Kbd>
        </KbdGroup>
      ) : null}
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
 * Tracks whether a horizontally-scrollable element is scrolled to (or past)
 * its right edge, so a right-edge fade can hide once there's nothing more to
 * reveal. Listens to scroll + resize; the 4px slack absorbs sub-pixel rounding.
 */
function useScrollAtEnd(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [atEnd, setAtEnd] = React.useState(true);

  React.useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    function check(): void {
      const el = ref.current;
      if (el === null) return;
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    }
    check();
    node.addEventListener('scroll', check);
    window.addEventListener('resize', check);
    return () => {
      node.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [ref]);

  return atEnd;
}

/**
 * Replaces the panel when no orgs exist for the current user.  Two CTAs:
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
