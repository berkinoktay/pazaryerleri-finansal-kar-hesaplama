'use client';

import * as React from 'react';

import {
  OrgStoreSwitcher,
  type Organization,
  type Store,
} from '@/components/patterns/org-store-switcher';

const SHOWCASE_ORGS: Organization[] = [
  {
    id: 'org-acme',
    name: 'Acme A.Ş.',
    role: 'OWNER',
    storeCount: 2,
    lastSyncedAt: '2026-04-25T11:55:00Z',
    lastAccessedAt: '2026-04-26T10:00:00Z',
  },
  {
    id: 'org-beta',
    name: 'Beta Ltd',
    role: 'ADMIN',
    storeCount: 5,
    lastSyncedAt: '2026-04-25T11:00:00Z',
    lastAccessedAt: '2026-04-25T18:00:00Z',
  },
  {
    id: 'org-gamma',
    name: 'Gamma Tekstil',
    role: 'MEMBER',
    storeCount: 1,
    lastSyncedAt: '2026-04-25T08:00:00Z',
    lastAccessedAt: null,
  },
];

const SHOWCASE_STORES: Store[] = [
  {
    id: 'store-trendyol-acme',
    name: 'Trendyol Acme TR',
    platform: 'TRENDYOL',
    syncState: 'fresh',
    lastSyncedAt: '2026-04-25T11:55:00Z',
  },
  {
    id: 'store-hepsiburada-acme',
    name: 'Hepsiburada Acme',
    platform: 'HEPSIBURADA',
    syncState: 'stale',
    lastSyncedAt: '2026-04-25T09:00:00Z',
  },
  {
    id: 'store-trendyol-istanbul',
    name: 'Trendyol İstanbul',
    platform: 'TRENDYOL',
    syncState: 'failed',
    lastSyncedAt: '2026-04-25T05:00:00Z',
  },
];

export function OrgStoreSwitcherShowcase(): React.ReactElement {
  const [activeOrgId, setActiveOrgId] = React.useState<string>('org-acme');
  const [activeStoreId, setActiveStoreId] = React.useState<string>('store-trendyol-acme');

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-sm flex flex-col">
        <span className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
          Genişletilmiş (sidebar başlığı)
        </span>
        <div className="border-border bg-card p-md w-rail-context rounded-md border">
          <OrgStoreSwitcher
            orgs={SHOWCASE_ORGS}
            stores={SHOWCASE_STORES}
            activeOrgId={activeOrgId}
            activeStoreId={activeStoreId}
            onSelectOrg={setActiveOrgId}
            onSelectStore={setActiveStoreId}
          />
        </div>
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
          Daraltılmış (collapsed sidebar)
        </span>
        {/*
          Frame width = collapsed sidebar inner column. The production
          AppShell renders the IconRail at `--size-rail-icon` (48px) plus
          a 4px outer padding on each side; 56px replicates that exact
          framing so `collapsed` mode previews at its real dimensions.
          Token would be over-specific (one consumer, one screen) — kept
          inline with an explicit "showcase frame" comment.
        */}
        <div
          className="border-border bg-card p-sm rounded-md border"
          // showcase frame: 48px icon-rail + 4px×2 outer padding
          style={{ width: '3.5rem' }}
        >
          <OrgStoreSwitcher
            orgs={SHOWCASE_ORGS}
            stores={SHOWCASE_STORES}
            activeOrgId={activeOrgId}
            activeStoreId={activeStoreId}
            onSelectOrg={setActiveOrgId}
            onSelectStore={setActiveStoreId}
            collapsed
          />
        </div>
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
          Boş durum (henüz organizasyon yok)
        </span>
        <div className="border-border bg-card p-md w-rail-context rounded-md border">
          <OrgStoreSwitcher
            orgs={[]}
            stores={[]}
            activeOrgId={null}
            activeStoreId={null}
            onSelectOrg={() => undefined}
            onSelectStore={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}
