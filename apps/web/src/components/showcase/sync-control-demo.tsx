'use client';

import * as React from 'react';

import { SyncControl, type SyncControlState } from '@/components/patterns/sync-control';
import {
  SyncSourcesPopover,
  type SyncSourceRowVM,
} from '@/components/patterns/sync-sources-popover';

// Fixed ISO refs — a client component must never read a runtime clock at module
// scope (SSR-safe). The control swaps to a relative label after mount.
const DEMO_LAST_SYNCED = '2026-04-20T21:00:00Z';
const DEMO_NEXT_ATTEMPT = '2026-04-20T21:05:00Z';

/** The idle + in-flight states worth showing side by side in the showcase. */
export const SYNC_CONTROL_DEMO_STATES: readonly SyncControlState[] = [
  'fresh',
  'syncing',
  'stale',
  'failed',
];

/**
 * A self-contained SyncControl instance with a canned source-breakdown popover.
 * Static demo only — `onSync` is a no-op and every timestamp is a fixed ISO
 * string. Drives the SyncControl gallery on the status showcase and the single
 * inline instances in the chrome / layout demos.
 */
export function SyncControlDemo({
  state,
  onOpenHistory,
}: {
  state: SyncControlState;
  onOpenHistory?: () => void;
}): React.ReactElement {
  const progress = state === 'syncing' ? { current: 142, total: 250 } : null;
  // `failed` is terminal — only the `retrying` state carries a next-attempt time.
  const nextAttemptAt = state === 'retrying' ? DEMO_NEXT_ATTEMPT : null;

  const sources: SyncSourceRowVM[] = [
    {
      syncType: 'ORDERS',
      state,
      lastSyncedAt: DEMO_LAST_SYNCED,
      progress,
      nextAttemptAt,
      errorLabel: state === 'failed' ? 'Kimlik doğrulama başarısız' : null,
    },
    {
      syncType: 'SETTLEMENTS',
      state: 'fresh',
      lastSyncedAt: DEMO_LAST_SYNCED,
      progress: null,
      nextAttemptAt: null,
      errorLabel: null,
    },
  ];

  return (
    <SyncControl
      state={state}
      lastSyncedAt={DEMO_LAST_SYNCED}
      progress={progress}
      nextAttemptAt={nextAttemptAt}
      onSync={() => undefined}
    >
      <SyncSourcesPopover
        title="Siparişler verisi"
        storeName="Trendyol Ana Mağaza"
        sources={sources}
        others={[]}
        scheduleLabel="Siparişler webhook ile anında düşer · saatlik tarama yedeği"
        onOpenHistory={onOpenHistory ?? (() => undefined)}
      />
    </SyncControl>
  );
}
