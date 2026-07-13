'use client';

import type { components } from '@pazarsync/api-client';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
} from '@/components/patterns/org-store-switcher';
import { useSwitcherPreviewStores } from '@/features/stores/hooks/use-switcher-preview-stores';
import { storeKeys } from '@/features/stores/query-keys';

// The panel fetches a non-active org's stores via useStores → storeKeys.list,
// then maps API stores through toSwitcherStore. The preview cache therefore
// holds API-shaped stores, not the slim switcher shape.
type ApiStore = components['schemas']['Store'];

// ── Multi-org demo data ─────────────────────────────────────────────────────
// Three orgs spanning the full role vocabulary (OWNER / ADMIN / MEMBER). Acme
// is the active org; Beta and Gamma are previewed straight from the pre-seeded
// query cache below, so opening the popover never hits the network.
const MULTI_ORGS: Organization[] = [
  { id: 'org-acme', name: 'Acme A.Ş.', role: 'OWNER' },
  { id: 'org-beta', name: 'Beta Ticaret', role: 'ADMIN' },
  { id: 'org-gamma', name: 'Gamma Tekstil', role: 'MEMBER' },
];

// Active org's stores (switcher shape) — 2× Trendyol, 1× Hepsiburada.
const ACME_STORES: Store[] = [
  { id: 'store-acme-ty-anadolu', name: 'Acme Trendyol', platform: 'TRENDYOL' },
  { id: 'store-acme-ty-istanbul', name: 'Acme Trendyol İstanbul', platform: 'TRENDYOL' },
  { id: 'store-acme-hb', name: 'Acme Hepsiburada', platform: 'HEPSIBURADA' },
];

// Beta has stores → previewing it lists them; picking one fires onSelectScope
// (a cross-org jump: switch org AND store in one step).
const BETA_STORES: Store[] = [
  { id: 'store-beta-ty', name: 'Beta Trendyol', platform: 'TRENDYOL' },
  { id: 'store-beta-hb', name: 'Beta Hepsiburada', platform: 'HEPSIBURADA' },
];

// Gamma has no stores yet → previewing it renders the "Bu organizasyona geç"
// empty branch instead of a store list.
const GAMMA_STORES: Store[] = [];

const MULTI_STORES_BY_ORG: Record<string, Store[]> = {
  'org-acme': ACME_STORES,
  'org-beta': BETA_STORES,
  'org-gamma': GAMMA_STORES,
};

// ── Single-org demo data ────────────────────────────────────────────────────
// One org → the panel hides the org pane and shows only the full-width store
// list. No cross-org preview, so nothing to seed.
const SINGLE_ORG: Organization[] = [{ id: 'org-solo', name: 'Solo Ticaret', role: 'OWNER' }];
const SINGLE_ORG_STORES: Store[] = [
  { id: 'store-solo-ty', name: 'Solo Trendyol', platform: 'TRENDYOL' },
  { id: 'store-solo-hb', name: 'Solo Hepsiburada', platform: 'HEPSIBURADA' },
];
const SINGLE_STORES_BY_ORG: Record<string, Store[]> = {
  'org-solo': SINGLE_ORG_STORES,
};

// ── Preview cache seed ──────────────────────────────────────────────────────
// Frozen ISO strings — never rendered by the switcher (toSwitcherStore keeps
// only id/name/platform); they exist solely to satisfy the API Store shape and
// keep the module SSR-safe (no Date.now / new Date).
const MOCK_TIMESTAMP = '2026-04-21T10:30:00Z';
const MOCK_EXTERNAL_ACCOUNT_ID = '900000';

function toApiStore(store: Store): ApiStore {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    environment: 'PRODUCTION',
    externalAccountId: MOCK_EXTERNAL_ACCOUNT_ID,
    status: 'ACTIVE',
    lastConnectedAt: MOCK_TIMESTAMP,
    lastSyncAt: MOCK_TIMESTAMP,
    createdAt: MOCK_TIMESTAMP,
    updatedAt: MOCK_TIMESTAMP,
  };
}

// Seed every multi-org store list — not just the two initially-non-active orgs
// — so previewing any org stays network-free even after the active org has been
// switched (e.g. after picking a Beta store, previewing Acme now needs a fetch).
const PREVIEW_CACHE_SEED: ReadonlyArray<{ orgId: string; stores: ApiStore[] }> = MULTI_ORGS.map(
  (org) => ({
    orgId: org.id,
    stores: (MULTI_STORES_BY_ORG[org.id] ?? []).map(toApiStore),
  }),
);

const noop = (): void => undefined;

export function OrgStoreSwitcherShowcase(): React.ReactElement {
  const queryClient = useQueryClient();

  // One-time: pre-seed the non-active orgs' store lists so opening the popover
  // and previewing another org resolves from cache with zero network calls.
  // staleTime/gcTime are pinned to Infinity for these keys so a later preview
  // (past the 30s default staleTime, or after gc) never triggers a background
  // fetch against the mock org ids — mock ids can't collide with real UUIDs, so
  // pinning defaults on the shared client is safe.
  React.useEffect(() => {
    for (const { orgId, stores } of PREVIEW_CACHE_SEED) {
      queryClient.setQueryDefaults(storeKeys.list(orgId), {
        staleTime: Infinity,
        gcTime: Infinity,
      });
      queryClient.setQueryData<ApiStore[]>(storeKeys.list(orgId), stores);
    }
  }, [queryClient]);

  return (
    <div className="gap-lg flex flex-col">
      <DemoSection
        label="Geniş tetikleyici + iki panelli menü"
        hint="Aktif organizasyon Acme, üç mağazayla. Beta'yı önizle → başka organizasyonun mağazaları listelenir (birini seçince kapsam tek adımda değişir); Gamma'yı önizle → henüz mağazası yok → “Bu organizasyona geç”. Menü ⌘O ile de açılır."
      >
        {/* First demo keeps the ⌘O hotkey; the rest disable it so one keypress
            doesn't open every switcher on the page at once. */}
        <SwitcherDemo
          orgs={MULTI_ORGS}
          storesByOrg={MULTI_STORES_BY_ORG}
          initialOrgId="org-acme"
          initialStoreId="store-acme-ty-anadolu"
        />
      </DemoSection>

      <DemoSection
        label="Daraltılmış (ray) — dialog kabuğu"
        hint="Aynı veri, daraltılmış rayda: tetikleyici ikon-döşemeye iner, menü popover yerine ortalı bir dialog olarak açılır."
      >
        <SwitcherDemo
          orgs={MULTI_ORGS}
          storesByOrg={MULTI_STORES_BY_ORG}
          initialOrgId="org-acme"
          initialStoreId="store-acme-ty-anadolu"
          collapsed
          hotkey={false}
        />
      </DemoSection>

      <DemoSection
        label="Tek organizasyon"
        hint="Tek organizasyonda sol organizasyon paneli gizlenir; yalnız mağaza listesi tam genişlikte kalır."
      >
        <SwitcherDemo
          orgs={SINGLE_ORG}
          storesByOrg={SINGLE_STORES_BY_ORG}
          initialOrgId="org-solo"
          initialStoreId="store-solo-ty"
          hotkey={false}
        />
      </DemoSection>

      <DemoSection
        label="Boş durum"
        hint="Henüz organizasyon yokken tetikleyici oluştur / davetle-katıl CTA'larına düşer; seçilecek bir kapsam yoktur."
      >
        <SwitcherFrame>
          <OrgStoreSwitcher
            orgs={[]}
            stores={[]}
            activeOrgId={null}
            activeStoreId={null}
            onSelectOrg={noop}
            onSelectStore={noop}
            onSelectScope={noop}
            usePreviewStores={useSwitcherPreviewStores}
            hotkey={false}
          />
        </SwitcherFrame>
      </DemoSection>
    </div>
  );
}

interface DemoSectionProps {
  label: string;
  hint: string;
  children: React.ReactNode;
}

/** Uppercase micro-label + a one-line hint, then the framed demo underneath. */
function DemoSection({ label, hint, children }: DemoSectionProps): React.ReactElement {
  return (
    <div className="gap-sm flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
          {label}
        </span>
        <p className="text-muted-foreground-dim text-2xs max-w-prose-max leading-snug">{hint}</p>
      </div>
      {children}
    </div>
  );
}

interface SwitcherDemoProps {
  orgs: Organization[];
  storesByOrg: Record<string, Store[]>;
  initialOrgId: string | null;
  initialStoreId: string | null;
  collapsed?: boolean;
  /** Register the ⌘O hotkey — only the first demo on the page should. */
  hotkey?: boolean;
}

/**
 * Wires an OrgStoreSwitcher to local state so selections are live in the
 * showcase, and surfaces a "son eylem" caption so which callback fired is
 * visible during a visual test. The displayed stores follow the active org
 * (via `storesByOrg`) so the trigger stays coherent after a cross-org jump.
 */
function SwitcherDemo({
  orgs,
  storesByOrg,
  initialOrgId,
  initialStoreId,
  collapsed = false,
  hotkey = true,
}: SwitcherDemoProps): React.ReactElement {
  const [activeOrgId, setActiveOrgId] = React.useState<string | null>(initialOrgId);
  const [activeStoreId, setActiveStoreId] = React.useState<string | null>(initialStoreId);
  const [lastAction, setLastAction] = React.useState<string | null>(null);

  const activeStores = activeOrgId !== null ? (storesByOrg[activeOrgId] ?? []) : [];

  function orgName(orgId: string): string {
    return orgs.find((o) => o.id === orgId)?.name ?? orgId;
  }

  function handleSelectOrg(orgId: string): void {
    setActiveOrgId(orgId);
    setActiveStoreId(null);
    setLastAction(`Organizasyona geçildi: ${orgName(orgId)}`);
  }

  function handleSelectStore(storeId: string): void {
    setActiveStoreId(storeId);
    const name = activeStores.find((s) => s.id === storeId)?.name ?? storeId;
    setLastAction(`Mağaza seçildi: ${name}`);
  }

  function handleSelectScope(orgId: string, storeId: string, storeName: string): void {
    setActiveOrgId(orgId);
    setActiveStoreId(storeId);
    setLastAction(`Kapsam değişti: ${orgName(orgId)} · ${storeName}`);
  }

  return (
    <div className="gap-2xs flex flex-col">
      <SwitcherFrame collapsed={collapsed}>
        <OrgStoreSwitcher
          orgs={orgs}
          stores={activeStores}
          activeOrgId={activeOrgId}
          activeStoreId={activeStoreId}
          onSelectOrg={handleSelectOrg}
          onSelectStore={handleSelectStore}
          onSelectScope={handleSelectScope}
          usePreviewStores={useSwitcherPreviewStores}
          collapsed={collapsed}
          hotkey={hotkey}
        />
      </SwitcherFrame>
      <LastActionCaption action={lastAction} />
    </div>
  );
}

/** Frames the switcher at its real sidebar width — expanded or collapsed. */
function SwitcherFrame({
  collapsed = false,
  children,
}: {
  collapsed?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  if (collapsed) {
    // showcase frame: w-14 (56px) matches the collapsed rail's
    // --sidebar-width-icon (56px) so `collapsed` previews at its real width.
    return <div className="border-border bg-card p-sm w-14 rounded-md border">{children}</div>;
  }
  return (
    <div className="border-border bg-card p-md w-rail-context rounded-md border">{children}</div>
  );
}

/** The last callback the switcher fired, so it's visible during a visual test. */
function LastActionCaption({ action }: { action: string | null }): React.ReactElement {
  return (
    <p className="text-2xs px-2xs">
      {action !== null ? (
        <>
          <span className="text-muted-foreground-dim">Son eylem — </span>
          <span className="text-foreground font-medium">{action}</span>
        </>
      ) : (
        <span className="text-muted-foreground-dim">
          Bir seçim yapıldığında son eylem burada görünür.
        </span>
      )}
    </p>
  );
}
