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
        <div
          className="border-border bg-card p-md rounded-md border"
          style={{ width: 240 /* runtime-dynamic: framing demo container width */ }}
        >
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
        <div
          className="border-border bg-card p-sm rounded-md border"
          style={{ width: 56 /* runtime-dynamic: collapsed sidebar width frame */ }}
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
        <div
          className="border-border bg-card p-md rounded-md border"
          style={{ width: 240 /* runtime-dynamic: framing demo container width */ }}
        >
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
