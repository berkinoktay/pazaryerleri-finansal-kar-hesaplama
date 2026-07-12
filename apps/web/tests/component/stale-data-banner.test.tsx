import type { SyncType } from '@pazarsync/db/enums';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control the snapshot + the manual-sync action per test. vi.hoisted so the refs
// exist when the (hoisted) vi.mock factories below run.
const { usePageSyncSnapshotMock, startPageSyncMock } = vi.hoisted(() => ({
  usePageSyncSnapshotMock: vi.fn(),
  startPageSyncMock: vi.fn(),
}));

vi.mock('@/features/sync/hooks/use-page-sync-snapshot', () => ({
  usePageSyncSnapshot: () => usePageSyncSnapshotMock(),
}));

vi.mock('@/features/sync/hooks/use-start-page-sync', () => ({
  useStartPageSync: () => ({ startPageSync: startPageSyncMock, disabled: false }),
}));

import { StaleDataBanner } from '@/features/sync/components/stale-data-banner';
import type { PageSyncSnapshot } from '@/features/sync/hooks/use-page-sync-snapshot';
import type { PageSyncSourceRow, PageSyncState } from '@/features/sync/lib/derive-page-sync';
import { render, screen } from '@/../tests/helpers/render';

const NOW = new Date('2026-07-13T12:00:00.000Z');
const STALE_MESSAGE = /saattir güncellenmedi/;

function hoursBefore(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function makeSource(
  syncType: SyncType,
  state: PageSyncState,
  lastSyncedAt: string | null,
): PageSyncSourceRow {
  return {
    syncType,
    state,
    lastSyncedAt,
    recordsProcessed: lastSyncedAt === null ? null : 0,
    progress: null,
    nextAttemptAt: null,
    errorCode: null,
  };
}

function makeSnapshot(controlState: PageSyncState, sources: PageSyncSourceRow[]): PageSyncSnapshot {
  return {
    // lastSyncedAt intentionally null: the banner must no longer read the
    // control's all-sources timestamp — only the primary sources drive it.
    control: { state: controlState, lastSyncedAt: null, progress: null, nextAttemptAt: null },
    sources,
    others: [],
    now: NOW,
  };
}

describe('StaleDataBanner', () => {
  beforeEach(() => {
    usePageSyncSnapshotMock.mockReset();
    startPageSyncMock.mockReset();
  });

  it('shows the strip when the primary flow is aged even though a secondary is fresh (Returns)', () => {
    // Returns: primary CLAIMS 30h stale, secondary ORDERS 1h fresh. The fresh
    // ORDERS must not mask the aged CLAIMS.
    usePageSyncSnapshotMock.mockReturnValue(
      makeSnapshot('stale', [
        makeSource('CLAIMS', 'stale', hoursBefore(30)),
        makeSource('ORDERS', 'fresh', hoursBefore(1)),
      ]),
    );
    render(<StaleDataBanner pageKey="returns" />);
    expect(screen.getByText('Bu veriler 30 saattir güncellenmedi')).toBeInTheDocument();
  });

  it('stays hidden when a fresh primary delta covers an aged full scan (Products)', () => {
    // Products: PRODUCTS 30h old, PRODUCTS_DELTA 1h fresh — both primary. The
    // freshest primary keeps the page fresh, so no strip.
    usePageSyncSnapshotMock.mockReturnValue(
      makeSnapshot('stale', [
        makeSource('PRODUCTS', 'stale', hoursBefore(30)),
        makeSource('PRODUCTS_DELTA', 'fresh', hoursBefore(1)),
      ]),
    );
    render(<StaleDataBanner pageKey="products" />);
    expect(screen.queryByText(STALE_MESSAGE)).not.toBeInTheDocument();
  });

  it('stays hidden when the control is failed — the chip is already red', () => {
    usePageSyncSnapshotMock.mockReturnValue(
      makeSnapshot('failed', [makeSource('ORDERS', 'failed', hoursBefore(30))]),
    );
    render(<StaleDataBanner pageKey="orders" />);
    expect(screen.queryByText(STALE_MESSAGE)).not.toBeInTheDocument();
  });

  it('stays hidden when the control is retrying — the chip is already amber', () => {
    usePageSyncSnapshotMock.mockReturnValue(
      makeSnapshot('retrying', [makeSource('ORDERS', 'retrying', hoursBefore(30))]),
    );
    render(<StaleDataBanner pageKey="orders" />);
    expect(screen.queryByText(STALE_MESSAGE)).not.toBeInTheDocument();
  });
});
